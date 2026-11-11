import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Backup } from '@watchlist/shared';
import { buildApp } from '../../app.ts';
import { migrate, openPGlite, type Db } from '../../db/database.ts';
import { schemaDatabase } from '../../db/scoped.ts';
import { createServicesFromDb, type Services } from '../../services.ts';
import { Accounts } from './accounts.ts';
import { UserServices } from './user-services.ts';

const auth = { ownerEmail: 'owner@gmail.com', password: 'original-password', secret: 'test-secret', secure: true };
let db: Db;
let services: Services;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  db = openPGlite();
  await migrate(db);
  services = createServicesFromDb(db, { provider: {
    id: 'fake', getQuotes: async () => [], getTargets: async () => null, search: async () => [], getHistory: async () => [],
  } });
  app = await buildApp(services, { auth });
});
afterEach(async () => { await app.close(); await db.close(); });

const request = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, payload });
async function register(email: string) {
  const res = await request('', 'POST', '/api/register', { email, password: 'a-secure-test-password' });
  expect(res.statusCode, res.body).toBe(201);
  return String(res.headers['set-cookie']).split(';')[0]!;
}
async function ownerLogin() {
  const res = await request('', 'POST', '/api/login', { email: auth.ownerEmail, password: auth.password });
  expect(res.statusCode).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0]!;
}
const backup = async (cookie: string) => (await request(cookie, 'GET', '/api/backup')).json<Backup>();

describe('registro público y datos por cuenta', () => {
  it('conserva los datos previos y separa listas, operaciones, ajustes y copias incluso con los mismos IDs', async () => {
    const owner = await ownerLogin();
    await services.lists.rename(1, 'Lista privada original');
    await request(owner, 'POST', '/api/items', { listId: 1, symbol: 'OWNER', buyPrices: [10] });
    const operation = await request(owner, 'POST', '/api/operations', { operation: {
      type: 'buy', date: '2026-01-01', ticker: 'OWNER', shares: 10, amountEur: 100,
    }, instrument: { symbol: 'OWNER', name: 'Owner', currency: 'EUR' } });
    expect(operation.statusCode, operation.body).toBe(201);
    await services.backup.snapshot('copia del propietario');
    const original = await backup(owner);
    const a = await register('alice@example.com');
    const b = await register('bob@example.com');
    expect((await backup(a)).lists).toMatchObject([{ name: 'Vigilar nuevas', items: [] }]);
    expect((await backup(a)).portfolio?.operations).toEqual([]);
    expect((await request(a, 'GET', '/api/snapshots/1')).statusCode).toBe(404);
    expect((await request(a, 'DELETE', '/api/operations/1')).statusCode).toBe(404);
    const results = await Promise.all([a, b].map((cookie, i) => request(cookie, 'POST', '/api/items', { listId: 1, symbol: `USER${i}`, buyPrices: [20] })));
    expect(results.map((r) => r.json().id)).toEqual([1, 1]);
    await Promise.all([
      request(a, 'PATCH', '/api/items/1', { notes: 'solo Alice' }),
      request(b, 'PUT', '/api/settings', { defaultInvest: 9876 }),
    ]);
    expect((await backup(a)).lists[0]!.items[0]).toMatchObject({ symbol: 'USER0', notes: 'solo Alice' });
    expect((await backup(b)).lists[0]!.items[0]).toMatchObject({ symbol: 'USER1', notes: null });
    expect((await request(a, 'GET', '/api/settings')).json().defaultInvest).not.toBe(9876);
    const exported = await backup(a);
    expect((await request(a, 'POST', '/api/backup', { ...exported, lists: [] })).statusCode).toBe(200);
    expect((await request(a, 'GET', '/api/snapshots')).json()).toHaveLength(1);
    expect((await request(b, 'GET', '/api/snapshots')).json()).toEqual([]);
    expect((await backup(b)).lists[0]!.items).toHaveLength(1);
    const { exportedAt: _before, ...expected } = original;
    const { exportedAt: _after, ...actual } = await backup(owner);
    expect(actual).toEqual(expected);
  });

  it('normaliza correos, rechaza duplicados y contraseñas cortas, y no guarda credenciales en claro', async () => {
    const cookie = await register(' ALICE@Example.com ');
    expect((await request(cookie, 'GET', '/api/session')).json().user.email).toBe('alice@example.com');
    expect((await request('', 'POST', '/api/register', { email: 'alice@example.com', password: 'other-long-password' })).statusCode).toBe(409);
    expect((await request('', 'POST', '/api/register', { email: 'other@example.com', password: 'short' })).statusCode).toBe(400);
    const accounts = new Accounts(db);
    expect(await accounts.all()).toHaveLength(2);
    expect((await accounts.byEmail('alice@example.com'))?.password_hash).toMatch(/^scrypt:/);
    const namespaces = await db.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'account_%'");
    expect(namespaces).toHaveLength(1);
    const rows = await db.query<{ token_hash: string }>('SELECT token_hash FROM watchlist_auth.sessions');
    expect(rows[0]!.token_hash).not.toBe(cookie.split('=')[1]);
  });

  it('revoca la sesión al salir, rechaza su reutilización y conserva las cuentas al reiniciar', async () => {
    const cookie = await register('alice@example.com');
    await request(cookie, 'POST', '/api/logout');
    expect((await request(cookie, 'GET', '/api/lists')).statusCode).toBe(401);
    await app.close();
    app = await buildApp(services, { auth });
    const login = await request('', 'POST', '/api/login', { email: 'alice@example.com', password: 'a-secure-test-password' });
    expect(login.statusCode).toBe(200);
    await db.query('UPDATE watchlist_auth.sessions SET expires_at = now() - interval \'1 second\'');
    expect((await request(String(login.headers['set-cookie']).split(';')[0]!, 'GET', '/api/lists')).statusCode).toBe(401);
    await ownerLogin();
  });

  it('no admite registros desde otro origen y limita los intentos', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/register', headers: { origin: 'https://other.test' }, payload: {} })).statusCode).toBe(403);
    for (let i = 0; i < 5; i++) expect((await request('', 'POST', '/api/register', {})).statusCode).toBe(400);
    expect((await request('', 'POST', '/api/register', {})).statusCode).toBe(429);
  });

  it('aísla dispositivos, avisos, estado y transacciones sin recurrir a las tablas del propietario', async () => {
    await register('alice@example.com');
    const account = (await new Accounts(db).byEmail('alice@example.com'))!;
    const users = new UserServices(services);
    const alice = users.forSchema(account.db_schema, account.id);
    await services.push.subscribe({ endpoint: 'https://push.test/owner', keys: { auth: 'auth', p256dh: 'key' } }, 'Owner');
    expect(await alice.push.devices()).toEqual([]);
    expect(alice.push.accountId).toBe(account.id);
    await services.state.set('private', 'owner');
    expect(await alice.state.get('private', 'empty')).toBe('empty');
    await expect(alice.db.tx(async (tx) => { await tx.query("UPDATE lists SET name = 'rollback'"); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await alice.lists.all())[0]!.name).toBe('Vigilar nuevas');
    await db.exec('CREATE TABLE public.owner_only (secret TEXT)');
    await expect(alice.db.query('SELECT * FROM owner_only')).rejects.toThrow();
    expect(() => schemaDatabase(db, 'public, malicious')).toThrow();
  });
});
