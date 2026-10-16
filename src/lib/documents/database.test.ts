import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherAccount = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
let id: string;
const snapshot = {
  title: 'Teste',
  kind: 'text',
  content: 'Conteúdo',
  fontSize: 12,
  annotations: [],
  fields: {},
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TYPE account_role_enum AS ENUM ('owner','admin','agent','viewer');
    CREATE TABLE public.accounts (id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY, account_id uuid, account_role account_role_enum);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  `);
  const accountMigration = await readFile(
    'supabase/migrations/017_account_sharing.sql',
    'utf8'
  );
  const start = accountMigration.indexOf(
    'CREATE OR REPLACE FUNCTION is_account_member('
  );
  await db.exec(
    accountMigration.slice(start, accountMigration.indexOf('$$;', start) + 3)
  );
  await db.exec(
    await readFile('supabase/migrations/039_documents.sql', 'utf8')
  );
  await db.exec(
    await readFile(
      'supabase/migrations/040_document_owner_signature.sql',
      'utf8'
    )
  );
  await db.query('INSERT INTO accounts(id) VALUES ($1),($2)', [
    account,
    otherAccount,
  ]);
  await db.query(
    "INSERT INTO profiles VALUES ($1,$2,'agent'),($3,$4,'viewer')",
    [user, account, otherUser, otherAccount]
  );
  await db.query('UPDATE accounts SET owner_user_id=$1 WHERE id=$2', [
    user,
    account,
  ]);
}, 30000);
beforeEach(async () => {
  await db.exec('DELETE FROM account_document_signatures');
  id = randomUUID();
  await db.query(
    'INSERT INTO documents(id, account_id, created_by, updated_by, snapshot) VALUES ($1,$2,$3,$3,$4)',
    [id, account, user, JSON.stringify(snapshot)]
  );
});
afterEach(async () => {
  await db.exec('RESET ROLE');
});
afterAll(async () => {
  await db?.close();
});

describe('documents migration on PostgreSQL', () => {
  it('protects reusable ink and rejects revocation at the final signing transaction', async () => {
    const version = randomUUID(),
      strokes = [
        [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.8 },
        ],
      ];
    await db.query(
      'INSERT INTO account_document_signatures(account_id,owner_user_id,version,name,email,strokes,enabled) VALUES($1,$2,$3,$4,$5,$6,true)',
      [
        account,
        user,
        version,
        'Owner',
        'owner@example.invalid',
        JSON.stringify(strokes),
      ]
    );
    const signing = {
      ownerStamp: {
        version,
        userId: user,
        name: 'Owner',
        email: 'owner@example.invalid',
        strokes,
      },
      ownerPlacement: { page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.1 },
    };
    await db.query('UPDATE documents SET revision=2,snapshot=$1 WHERE id=$2', [
      JSON.stringify({ ...snapshot, signing }),
      id,
    ]);
    await db.exec('SET ROLE authenticated');
    await expect(
      db.query('SELECT * FROM account_document_signatures')
    ).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
    await db.query(
      'UPDATE account_document_signatures SET enabled=false WHERE account_id=$1',
      [account]
    );
    const sign = () =>
      db.query(
        "UPDATE documents SET status='signed',revision=3,signature='{}',signed_path='signed.pdf',signed_sha256='hash' WHERE id=$1",
        [id]
      );
    await expect(sign()).rejects.toThrow('authorization changed');
    await db.query(
      'UPDATE account_document_signatures SET enabled=true, version=$1 WHERE account_id=$2',
      [randomUUID(), account]
    );
    await expect(sign()).rejects.toThrow('authorization changed');
    await db.query(
      'UPDATE account_document_signatures SET version=$1 WHERE account_id=$2',
      [version, account]
    );
    await sign();
    expect(
      (await db.query('SELECT status FROM documents WHERE id=$1', [id])).rows
    ).toEqual([{ status: 'signed' }]);
  });
  it('creates an atomic version and keeps the storage bucket private', async () => {
    expect(
      (
        await db.query('SELECT * FROM document_versions WHERE document_id=$1', [
          id,
        ])
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await db.query<{ public: boolean }>(
          "SELECT public FROM storage.buckets WHERE id='documents'"
        )
      ).rows[0].public
    ).toBe(false);
    await db.query('UPDATE documents SET revision=2, snapshot=$1 WHERE id=$2', [
      JSON.stringify({ ...snapshot, content: 'New' }),
      id,
    ]);
    const versions = await db.query<{
      revision: number;
      snapshot: typeof snapshot;
    }>(
      'SELECT * FROM document_versions WHERE document_id=$1 ORDER BY revision',
      [id]
    );
    expect(versions.rows.map((row) => row.revision)).toEqual([1, 2]);
    expect(versions.rows[0].snapshot.content).toBe('Conteúdo');
  });
  it('does not let authenticated clients forge documents or rewrite history', async () => {
    await db.query("SELECT set_config('test.uid',$1,false)", [user]);
    await db.exec('SET ROLE authenticated');
    expect(
      (await db.query('SELECT * FROM documents WHERE id=$1', [id])).rows
    ).toHaveLength(1);
    await expect(
      db.query('UPDATE documents SET revision=2 WHERE id=$1', [id])
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('DELETE FROM document_versions WHERE document_id=$1', [id])
    ).rejects.toThrow('permission denied');
    await expect(
      db.query(
        'INSERT INTO documents(account_id,created_by,updated_by,snapshot) VALUES($1,$2,$2,$3)',
        [account, user, JSON.stringify(snapshot)]
      )
    ).rejects.toThrow('permission denied');
  });
  it('isolates accounts and denies anonymous reads', async () => {
    await db.query("SELECT set_config('test.uid',$1,false)", [otherUser]);
    await db.exec('SET ROLE authenticated');
    expect(
      (await db.query('SELECT * FROM documents WHERE id=$1', [id])).rows
    ).toHaveLength(0);
    expect(
      (
        await db.query('SELECT * FROM document_versions WHERE document_id=$1', [
          id,
        ])
      ).rows
    ).toHaveLength(0);
    await db.exec('RESET ROLE; SET ROLE anon');
    await expect(db.query('SELECT * FROM documents')).rejects.toThrow(
      'permission denied'
    );
  });
  it('rejects changing identity or skipping revisions', async () => {
    await expect(
      db.query('UPDATE documents SET revision=2, account_id=$1 WHERE id=$2', [
        otherAccount,
        id,
      ])
    ).rejects.toThrow('immutable');
    await expect(
      db.query('UPDATE documents SET revision=4 WHERE id=$1', [id])
    ).rejects.toThrow('Invalid revision');
    expect(
      (
        await db.query('SELECT * FROM document_versions WHERE document_id=$1', [
          id,
        ])
      ).rows
    ).toHaveLength(1);
  });
  it('allows only one concurrent compare-and-swap edit', async () => {
    const updates = await Promise.all(
      [1, 2].map(() =>
        db.query(
          'UPDATE documents SET revision=2 WHERE id=$1 AND revision=1 RETURNING id',
          [id]
        )
      )
    );
    expect(updates.map((result) => result.rows.length).sort()).toEqual([0, 1]);
    expect(
      (
        await db.query('SELECT * FROM document_versions WHERE document_id=$1', [
          id,
        ])
      ).rows
    ).toHaveLength(2);
  });
  it('requires the reviewed snapshot and makes signed documents immutable', async () => {
    await expect(
      db.query(
        "UPDATE documents SET status='signed', revision=2, signature='{}', signed_path='signed.pdf', signed_sha256='hash', snapshot=$1 WHERE id=$2",
        [JSON.stringify({ ...snapshot, content: 'changed' }), id]
      )
    ).rejects.toThrow('review');
    await db.query(
      "UPDATE documents SET status='signed', revision=2, signature='{}', signed_path='signed.pdf', signed_sha256='hash' WHERE id=$1 AND revision=1",
      [id]
    );
    await expect(
      db.query('UPDATE documents SET revision=3, snapshot=$1 WHERE id=$2', [
        JSON.stringify({ ...snapshot, content: 'tampered' }),
        id,
      ])
    ).rejects.toThrow('immutable');
    const history = await db.query<{ status: string }>(
      'SELECT status FROM document_versions WHERE document_id=$1 ORDER BY revision',
      [id]
    );
    expect(history.rows.map((row) => row.status)).toEqual(['draft', 'signed']);
    const staleSign = await db.query(
      "UPDATE documents SET revision=2, status='signed' WHERE id=$1 AND revision=1 AND status='draft' RETURNING id",
      [id]
    );
    expect(staleSign.rows).toHaveLength(0);
  });
});
