import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentError, validateSnapshot } from './validation';

const mocks = vi.hoisted(() => ({
  results: [] as unknown[],
  role: vi.fn(),
  write: vi.fn(),
  tables: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      mocks.tables(table);
      const result = () => Promise.resolve(mocks.results.shift());
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: result,
        single: result,
        insert: (value: unknown) => {
          mocks.write(value);
          return chain;
        },
        update: (value: unknown) => {
          mocks.write(value);
          return chain;
        },
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/documents/server', () => ({
  readJson: (request: Request) => request.json(),
  documentError: (err: { status?: number; message: string }) =>
    Response.json({ error: err.message }, { status: err.status ?? 500 }),
}));
import { getOwnerSignature, resolveOwnerStamp } from './owner-signature';
import { GET, PUT } from '@/app/api/account/document-signature/route';

const strokes = [
  [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.7 },
  ],
];
const row = {
  account_id: 'account',
  owner_user_id: 'owner',
  version: 'version',
  name: 'Owner',
  email: 'owner@example.invalid',
  strokes,
  enabled: true,
  authorized_at: '2026-10-16T12:00:00Z',
};
const ok = (data: unknown) => ({ data, error: null });
const ctx = {
  role: 'owner',
  accountId: 'account',
  userId: 'owner',
  supabase: {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'owner', email: 'owner@example.invalid' } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ok({ full_name: 'Owner' }) }),
      }),
    }),
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.results.length = 0;
  mocks.role.mockResolvedValue(ctx);
});
describe('default owner signature', () => {
  it('discards old owner ink after an ownership transfer', async () => {
    mocks.results.push(ok(row), ok({ owner_user_id: 'new-owner' }));
    expect(await getOwnerSignature('account')).toBeNull();
  });
  it('resolves reusable ink on the server rather than trusting request strokes', async () => {
    mocks.results.push(ok(row), ok({ owner_user_id: 'owner' }));
    const input = {
      kind: 'text',
      title: 'Test',
      content: 'Test',
      fontSize: 12,
      annotations: [],
      fields: {},
      signing: {
        clientName: 'Client',
        clientEmail: '',
        clientPlacement: null,
        ownerPlacement: { page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.1 },
        ownerStamp: { version: 'version', name: 'forged', strokes: [] },
      },
    };
    const result = await resolveOwnerStamp(
      'account',
      validateSnapshot(input),
      input
    );
    expect(result.signing?.ownerStamp).toMatchObject({
      name: 'Owner',
      strokes,
    });
    mocks.results.push(
      ok({ ...row, version: 'changed' }),
      ok({ owner_user_id: 'owner' })
    );
    await expect(
      resolveOwnerStamp('account', validateSnapshot(input), input)
    ).rejects.toThrow('mudou');
  });
  it('does not expose disabled defaults to agents', async () => {
    mocks.role.mockResolvedValue({ ...ctx, role: 'agent' });
    mocks.results.push(
      ok({ ...row, enabled: false }),
      ok({ owner_user_id: 'owner' })
    );
    expect(await (await GET()).json()).toEqual({ setting: null });
  });
  it('requires owner permission before writing', async () => {
    mocks.role.mockRejectedValue(new DocumentError('Forbidden', 403));
    expect(
      (
        await PUT(
          new Request('http://localhost', { method: 'PUT', body: '{}' })
        )
      ).status
    ).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith('owner');
    expect(mocks.tables).not.toHaveBeenCalled();
  });
  it('saves authorization with server identity and rejects stale versions', async () => {
    const request = () =>
      new Request('http://localhost', {
        method: 'PUT',
        body: JSON.stringify({
          version: null,
          enabled: true,
          strokes,
          name: 'forged',
          owner_user_id: 'forged',
        }),
      });
    mocks.results.push(
      ok({ owner_user_id: 'owner' }),
      ok(null),
      ok(null),
      ok({ version: 'saved' })
    );
    expect((await PUT(request())).status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_user_id: 'owner',
        name: 'Owner',
        email: 'owner@example.invalid',
        enabled: true,
        strokes,
      })
    );
    mocks.write.mockClear();
    mocks.results.push(
      ok({ owner_user_id: 'owner' }),
      ok(row),
      ok({ owner_user_id: 'owner' })
    );
    expect((await PUT(request())).status).toBe(409);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
