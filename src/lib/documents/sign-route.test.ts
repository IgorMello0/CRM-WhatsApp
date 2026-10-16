import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentError } from './validation';
import { contentHash } from './pdf';
import { SIGNING_CONSENT } from './types';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getDocument: vi.fn(),
  upload: vi.fn(),
  cleanup: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  result: vi.fn(),
  owner: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.requireRole }));
vi.mock('@/lib/documents/owner-signature', () => ({
  assertOwnerAuthorization: mocks.owner,
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ update: mocks.update }) }),
}));
vi.mock('@/lib/documents/server', () => ({
  getDocument: mocks.getDocument,
  original: async () => undefined,
  readJson: (request: Request) => request.json(),
  uploadPrivate: mocks.upload,
  cleanup: mocks.cleanup,
  assertDraft: (
    doc: { status: string; revision: number },
    revision: number
  ) => {
    if (doc.status !== 'draft' || doc.revision !== revision)
      throw new DocumentError('Conflict', 409);
  },
  documentError: (error: { status?: number; message: string }) =>
    Response.json({ error: error.message }, { status: error.status ?? 500 }),
}));
import { POST } from '@/app/api/documents/[id]/sign/route';

const snapshot = {
  title: 'Test',
  kind: 'text' as const,
  content: 'Test-only document',
  fontSize: 12,
  fields: {},
  annotations: [],
  signing: {
    clientName: 'Cliente de Teste',
    clientEmail: 'client@example.invalid',
    clientPlacement: { page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.07 },
    ownerPlacement: null,
    ownerStamp: null,
  },
};
const doc = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: 'account',
  status: 'draft',
  revision: 2,
  snapshot,
  source_sha256: null,
};
const body = {
  revision: 2,
  contentHash: contentHash(snapshot, null),
  consent: SIGNING_CONSENT,
  strokes: [
    [
      { x: 0.1, y: 0.5 },
      { x: 0.8, y: 0.2 },
    ],
  ],
};
const call = (input: unknown = body) =>
  POST(
    new Request('http://localhost/api/documents/id/sign', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ id: doc.id }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner.mockResolvedValue(undefined);
  mocks.requireRole.mockResolvedValue({
    userId: 'session-user',
    accountId: 'account',
    supabase: {
      auth: {
        getUser: async () => ({
          data: {
            user: { id: 'session-user', email: 'session@example.invalid' },
          },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { full_name: 'Session Name' },
              error: null,
            }),
          }),
        }),
      }),
    },
  });
  mocks.getDocument.mockResolvedValue(doc);
  mocks.upload.mockResolvedValue(undefined);
  mocks.cleanup.mockResolvedValue(undefined);
  const chain = { eq: mocks.eq, select: () => ({ maybeSingle: mocks.result }) };
  mocks.eq.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.result.mockResolvedValue({
    data: { ...doc, status: 'signed' },
    error: null,
  });
});
describe('document signing endpoint', () => {
  it('rejects templates and incomplete customer placeholders before uploading', async () => {
    for (const changes of [
      { isTemplate: true },
      { content: 'Cliente: {{nome_cliente}}' },
    ]) {
      const incomplete = { ...snapshot, ...changes };
      mocks.getDocument.mockResolvedValue({ ...doc, snapshot: incomplete });
      expect(
        (await call({ ...body, contentHash: contentHash(incomplete, null) }))
          .status
      ).toBe(400);
    }
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires agent permission before accessing a document', async () => {
    mocks.requireRole.mockRejectedValue(new DocumentError('Forbidden', 403));
    expect((await call()).status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects stale versions, stale content, missing consent and empty drawings', async () => {
    for (const changes of [
      { revision: 1 },
      { contentHash: 'different' },
      { consent: false },
      { strokes: [] },
    ])
      expect(
        (await call({ ...body, ...changes })).status
      ).toBeGreaterThanOrEqual(400);
    expect(mocks.upload).not.toHaveBeenCalled();
    mocks.getDocument.mockResolvedValue({ ...doc, status: 'signed' });
    expect((await call()).status).toBe(409);
  });
  it('uses the saved customer identity and records the authenticated collector separately', async () => {
    expect(
      (
        await call({
          ...body,
          name: 'Spoofed',
          email: 'fake@example.invalid',
          userId: 'other',
        })
      ).status
    ).toBe(200);
    expect(mocks.update.mock.calls[0][0].signature).toMatchObject({
      name: 'Cliente de Teste',
      email: 'client@example.invalid',
      userId: null,
      collectedBy: 'session-user',
      mode: 'in_person',
      revision: 2,
    });
    expect(mocks.eq.mock.calls).toEqual([
      ['id', doc.id],
      ['account_id', 'account'],
      ['revision', 2],
      ['status', 'draft'],
    ]);
    expect(mocks.upload.mock.calls[0][0]).toMatch(
      /^account\/11111111-1111-4111-8111-111111111111\/signed-/
    );
    expect(mocks.update.mock.calls[0][0].signed_sha256).toMatch(
      /^[0-9a-f]{64}$/
    );
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it('cleans up an unreferenced upload only after a definite lost race', async () => {
    mocks.result.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(409);
    expect(mocks.cleanup).toHaveBeenCalledWith(mocks.upload.mock.calls[0][0]);
  });
  it('rejects revoked owner authorization before uploading or committing', async () => {
    mocks.owner.mockRejectedValue(
      new DocumentError('Authorization revoked', 409)
    );
    expect((await call()).status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires customer identity and an on-page position', async () => {
    const noPosition = {
      ...snapshot,
      signing: { ...snapshot.signing, clientPlacement: null },
    };
    mocks.getDocument.mockResolvedValue({ ...doc, snapshot: noPosition });
    expect(
      (await call({ ...body, contentHash: contentHash(noPosition, null) }))
        .status
    ).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('does not delete a potentially committed PDF after an uncertain database response', async () => {
    mocks.result.mockResolvedValue({
      data: null,
      error: new Error('Network failed'),
    });
    expect((await call()).status).toBe(500);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it('does not mark a document signed when private storage fails', async () => {
    mocks.upload.mockRejectedValue(new DocumentError('Storage failed', 500));
    expect((await call()).status).toBe(500);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
