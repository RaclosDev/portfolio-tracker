import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAuth } from './auth.ts';
import { migrate, openPGlite, type Db } from '../../db/database.ts';
import { createServicesFromDb } from '../../services.ts';
import { UserServices } from './user-services.ts';

const { getToken, verifyIdToken } = vi.hoisted(() => ({ getToken: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    getToken = getToken;
    verifyIdToken = verifyIdToken;
  },
}));

const owner = 'owner@gmail.com';
let app: ReturnType<typeof Fastify>;
let db: Db;
beforeEach(async () => {
  vi.resetAllMocks();
  app = Fastify();
  db = openPGlite();
  await migrate(db);
  const services = createServicesFromDb(db);
  await registerAuth(app, {
    ownerEmail: owner, password: 'test-password', secret: 'test-secret', secure: true,
    google: { clientId: 'test-client', clientSecret: 'test-client-secret', publicUrl: 'https://cartera.test' },
  }, services, new UserServices(services));
  app.get('/api/private', async () => ({ ok: true }));
});
afterEach(async () => { await app.close(); await db.close(); });

async function start(session = '') {
  const response = await app.inject({ url: '/api/auth/google', headers: { cookie: session } });
  const url = new URL(response.headers.location!);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('redirect_uri')).toBe('https://cartera.test/api/auth/google/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  return { cookie: session ? `${session}; ${cookie}` : cookie, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
}

describe('acceso con Google', () => {
  it('conserva el acceso de Google del propietario con su identidad verificada', async () => {
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
    { email: 'invalid-email', email_verified: true },
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

  it('crea una cuenta independiente para otro usuario de Google y reutiliza su identidad', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { cookie, state, nonce } = await start();
      getToken.mockResolvedValue({ tokens: { id_token: 'token' } });
      verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'new@gmail.com', email_verified: true, nonce, sub: 'new-sub' }) });
      const callback = await app.inject({ url: `/api/auth/google/callback?code=code&state=${state}`, headers: { cookie } });
      expect(callback.headers.location).toBe('/');
      const session = (callback.headers['set-cookie'] as string[]).find((entry) => entry.startsWith('wl_sesion='))!.split(';')[0]!;
      ids.push((await app.inject({ url: '/api/session', headers: { cookie: session } })).json().user.id);
    }
    expect(ids[0]).toBe(ids[1]);
    const accounts = await db.query<{ db_schema: string }>('SELECT db_schema FROM watchlist_auth.accounts');
    expect(accounts).toHaveLength(2);
    expect(accounts.some((a) => a.db_schema.startsWith('account_'))).toBe(true);
  });

  it('solo vincula un correo ya registrado desde la sesión de esa cuenta', async () => {
    const registered = await app.inject({ method: 'POST', url: '/api/register', payload: { email: 'new@gmail.com', password: 'a-long-password' } });
    const session = String(registered.headers['set-cookie']).split(';')[0]!;
    for (const authenticated of [false, true]) {
      const { cookie, state, nonce } = await start(authenticated ? session : '');
      getToken.mockResolvedValue({ tokens: { id_token: 'token' } });
      verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: 'new@gmail.com', email_verified: true, nonce, sub: 'new-sub' }) });
      const callback = await app.inject({ url: `/api/auth/google/callback?code=code&state=${state}`, headers: { cookie } });
      expect(callback.headers.location).toBe(authenticated ? '/' : '/?login=google-account-exists');
    }
    expect((await app.inject({ url: '/api/session', headers: { cookie: session } })).json().user.googleLinked).toBe(true);
  });

  it('no completa una vinculación si se ha cerrado la sesión original', async () => {
    const registered = await app.inject({ method: 'POST', url: '/api/register', payload: { email: 'new@gmail.com', password: 'a-long-password' } });
    const session = String(registered.headers['set-cookie']).split(';')[0]!;
    const { cookie, state } = await start(session);
    await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: session } });
    const callback = await app.inject({ url: `/api/auth/google/callback?code=code&state=${state}`, headers: { cookie } });
    expect(callback.headers.location).toBe('/?login=google-error');
    expect(getToken).not.toHaveBeenCalled();
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
