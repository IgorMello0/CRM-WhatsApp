import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt } from '@/lib/whatsapp/encryption';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  upsert: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) =>
      table === 'profiles'
        ? { select: () => ({ eq: mocks.eq }) }
        : { upsert: mocks.upsert },
  }),
}));

import { POST } from './route';

function request(access_token: unknown = 'test-short-token') {
  return new Request('http://localhost/api/whatsapp/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token }),
  });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_FACEBOOK_APP_ID', 'test-app');
  vi.stubEnv('FACEBOOK_APP_SECRET', 'test-secret');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.eq.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: { account_id: 'account-1' } });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.fetch.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Meta authentication configuration', () => {
  it('resolves the auth user and stores an encrypted token with ownership', async () => {
    for (const body of [
      { access_token: 'test-long-token' },
      { data: [{ id: 'business-1' }] },
      { data: [{ id: 'waba-1' }] },
      { data: [{ id: 'phone-1' }] },
    ]) {
      mocks.fetch.mockResolvedValueOnce(Response.json(body));
    }

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-1');
    const [saved, options] = mocks.upsert.mock.calls[0];
    expect(saved).toMatchObject({
      account_id: 'account-1',
      user_id: 'user-1',
      provider: 'meta',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
    });
    expect(options).toEqual({ onConflict: 'account_id' });
    expect(saved.access_token).not.toBe('test-long-token');
    expect(decrypt(saved.access_token)).toBe('test-long-token');
  });

  it('rejects unauthenticated requests before contacting Meta', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([null, 42, {}, '   '])(
    'rejects an invalid token: %j',
    async (token) => {
      expect((await POST(request(token))).status).toBe(400);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    }
  );
});
