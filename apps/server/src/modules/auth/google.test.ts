import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuth } from './auth.ts';

const { getToken, verifyIdToken } = vi.hoisted(() => ({ getToken: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    getToken = getToken;
    verifyIdToken = verifyIdToken;
  },
}));

const owner = 'owner@gmail.com';
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  vi.resetAllMocks();
  app = Fastify();
  registerAuth(app, {
    ownerEmail: owner, password: 'test-password', secret: 'test-secret', secure: true,
    google: { clientId: 'test-client', clientSecret: 'test-client-secret', publicUrl: 'https://cartera.test' },
  });
  app.get('/api/private', async () => ({ ok: true }));
});
afterEach(() => app.close());

async function start() {
  const response = await app.inject('/api/auth/google');
  const url = new URL(response.headers.location!);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('redirect_uri')).toBe('https://cartera.test/api/auth/google/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  return { cookie, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
}

describe('acceso con Google', () => {
  it('solo emite la sesión de cartera con la identidad propietaria verificada y el nonce del flujo', async () => {
    const { cookie, state, nonce } = await start();
    getToken.mockResolvedValue({ tokens: { id_token: 'google-id-token' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: owner, email_verified: true, nonce, sub: 'test-sub' }) });
    const callback = await app.inject({ url: `/api/auth/google/callback?code=code&state=${state}`, headers: { cookie } });
    expect(callback.headers.location).toBe('/');
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'google-id-token', audience: 'test-client' });
    const cookies = callback.headers['set-cookie'];
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringMatching(/^wl_google=;.*Max-Age=0/),
      expect.stringMatching(/^wl_sesion=.+HttpOnly.*Secure/),
    ]));
    const session = (cookies as string[]).find((entry) => entry.startsWith('wl_sesion='))!.split(';')[0]!;
    expect((await app.inject({ url: '/api/private', headers: { cookie: session } })).statusCode).toBe(200);
  });

  it.each([
    { email: 'other@gmail.com', email_verified: true },
    { email: owner, email_verified: false },
    { email: owner, email_verified: true, nonce: 'incorrecto' },
  ])('rechaza una identidad no válida: %j', async (identity) => {
    const { cookie, state, nonce } = await start();
    getToken.mockResolvedValue({ tokens: { id_token: 'google-id-token' } });
    verifyIdToken.mockResolvedValue({ getPayload: () => ({ nonce, sub: 'test-sub', ...identity }) });
    const callback = await app.inject({ url: `/api/auth/google/callback?code=code&state=${state}`, headers: { cookie } });
    expect(callback.headers.location).toBe('/?login=google-error');
    expect(String(callback.headers['set-cookie'])).not.toContain('wl_sesion=');
  });

  it('rechaza el callback sin la cookie de origen o con un state ajeno', async () => {
    const { cookie, state } = await start();
    for (const [value, headers] of [[state, {}], ['x'.repeat(43), { cookie }]] as const) {
      const response = await app.inject({ url: `/api/auth/google/callback?code=code&state=${value}`, headers });
      expect(response.headers.location).toBe('/?login=google-error');
    }
    expect(getToken).not.toHaveBeenCalled();
  });
});
