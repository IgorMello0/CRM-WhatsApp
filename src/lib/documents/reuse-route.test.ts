import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentError } from './validation';
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  get: vi.fn(),
  insert: vi.fn(),
  render: vi.fn(),
  original: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: mocks.insert }) }),
}));
vi.mock('@/lib/documents/pdf', () => ({ renderPdf: mocks.render }));
vi.mock('@/lib/documents/server', () => ({
  getDocument: mocks.get,
  original: mocks.original,
  readJson: (req: Request) => req.json(),
  documentError: (error: { status?: number; message: string }) =>
    Response.json({ error: error.message }, { status: error.status ?? 500 }),
}));
import { POST } from '@/app/api/documents/[id]/reuse/route';
const ctx = { accountId: 'account-a', userId: 'user-a' };
const source = {
  id: 'source',
  revision: 3,
  account_id: 'account-a',
  status: 'signed',
  source_path: 'account-a/source/original.pdf',
  source_sha256: 'original-hash',
  signed_path: 'account-a/source/signed.pdf',
  signature: { strokes: 'never-copy' },
  snapshot: {
    title: 'Base',
    kind: 'pdf',
    content: '',
    fontSize: 12,
    fields: { Nome: '{{nome_cliente}}' },
    annotations: [],
    isTemplate: true,
  },
};
const input = {
  revision: 3,
  action: 'instantiate',
  title: 'Cópia para Ana',
  clientName: 'Ana',
  clientEmail: '',
  values: { nome_cliente: 'Ana' },
};
const call = (body: unknown = input) =>
  POST(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'source' }) }
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue(ctx);
  mocks.get.mockResolvedValue(source);
  mocks.original.mockResolvedValue(new Uint8Array([1]));
  mocks.render.mockResolvedValue(new Uint8Array([2]));
  mocks.insert.mockImplementation((value) => ({
    select: () => ({ single: async () => ({ data: value, error: null }) }),
  }));
});
describe('template copy endpoint', () => {
  it('requires agent access and loads the source using the current account context', async () => {
    mocks.role.mockRejectedValue(new DocumentError('Forbidden', 403));
    expect((await call()).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.role.mockResolvedValue(ctx);
    await call();
    expect(mocks.role).toHaveBeenCalledWith('agent');
    expect(mocks.get).toHaveBeenCalledWith(ctx, 'source');
  });
  it('creates a new account-scoped document referencing only the original PDF', async () => {
    expect((await call()).status).toBe(201);
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      account_id: 'account-a',
      created_by: 'user-a',
      updated_by: 'user-a',
      source_path: source.source_path,
      source_sha256: 'original-hash',
      snapshot: {
        isTemplate: false,
        fields: { Nome: 'Ana' },
        signing: { clientName: 'Ana', ownerStamp: null },
      },
    });
    expect(inserted.id).not.toBe(source.id);
    expect(inserted.signed_path).toBeUndefined();
    expect(inserted.signature).toBeUndefined();
    expect(inserted.status).toBeUndefined();
  });
  it('does not create a copy when revision, required data or PDF validation fail', async () => {
    expect((await call({ ...input, revision: 2 })).status).toBe(409);
    expect((await call({ ...input, values: {} })).status).toBe(400);
    mocks.render.mockRejectedValue(new DocumentError('Invalid PDF', 400));
    expect((await call()).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
