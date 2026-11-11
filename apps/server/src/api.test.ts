/**
 * Tests de la API de punta a punta (Fastify inject) con un Postgres en memoria (PGlite) y un
 * proveedor de cotizaciones simulado: no dependen de internet, de Neon ni de Yahoo.
 */
import { DEFAULT_COLORS, DEFAULT_SETTINGS, type CarteraView, type Settings, type WatchlistView } from '@watchlist/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { AuthOptions } from './modules/auth/auth.ts';
import { migrate, openPGlite, type Db } from './db/database.ts';
import type { MarketDataProvider } from './modules/market/provider.ts';
import { createServicesFromDb } from './services.ts';

const now = () => new Date().toISOString();
const quote = (symbol: string, price: number, currency: string) => ({
  symbol, name: `${symbol} S.A.`, currency, price, changePct: 0.01, previousClose: price, low52: price * 0.8,
  high52: price * 1.2, quoteType: 'EQUITY', exchange: 'Test', marketState: 'REGULAR', fetchedAt: now(),
});

class FakeProvider implements MarketDataProvider {
  readonly id = 'prueba';
  failWith: string | null = null;
  calls = 0;
  async getQuotes(symbols: string[]) {
    this.calls++;
    if (this.failWith) throw new Error(this.failWith);
    const all = [quote('AAA.MC', 10, 'EUR'), quote('BBB', 50, 'USD'), quote('EURUSD=X', 1.1, 'USD')];
    return all.filter((q) => symbols.includes(q.symbol));
  }
  async getTargets() {
    return { mean: 12, median: 12, high: 14, low: 9, analysts: 5, recommendation: 'buy', recommendationMean: 2, trailingPE: 18.5, dividendYield: 0.031 };
  }
  async search() {
    return [];
  }
  async getHistory() {
    return [10, 11, 9.5, 10.2].map((c, i) => ({ t: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), c }));
  }
  async getProfile(symbol: string) {
    return { sector: symbol === 'BBB' ? 'Tecnología' : 'Industria', name: `${symbol} S.A.` };
  }
}

let provider: FakeProvider;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

async function setup(auth?: AuthOptions) {
  db = openPGlite();
  await migrate(db);
  provider = new FakeProvider();
  app = await buildApp(createServicesFromDb(db, { provider }), { auth });
}

let cookie = '';
const headers = () => ({ host: 'cartera.test', ...(cookie ? { cookie } : {}) });
const get = (url: string) => app.inject({ method: 'GET', url, headers: headers() });
const send = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: headers() });

beforeEach(async () => {
  cookie = '';
  await setup();
});
afterEach(async () => {
  await app.close();
  await db.close();
});

describe('acceso', () => {
  const ownerEmail = 'cartera@example.com';

  beforeEach(async () => {
    await app.close();
    await db.close();
    await setup({ ownerEmail, password: 'pan-con-tomate', secret: 'x'.repeat(32), secure: true });
  });

  it('sin entrar no se ven los datos; con la contraseña sí', async () => {
    expect((await get('/api/lists')).statusCode).toBe(401);
    const health = await get('/api/health');
    expect(health.statusCode).toBe(200);
    // El lector de Excel usa workers blob:; si la CSP los bloquea, importar se cuelga sin error.
    expect(String(health.headers['content-security-policy'])).toMatch(/worker-src 'self' blob:/);
    expect((await get('/api/session')).json()).toMatchObject({ authRequired: true, authenticated: false, googleEnabled: false });
    expect((await send('POST', '/api/login', { email: ownerEmail, password: 'otra' })).statusCode).toBe(401);
    expect((await send('POST', '/api/login', { email: 'otra@example.com', password: 'pan-con-tomate' })).statusCode).toBe(401);
    expect((await send('POST', '/api/login', { password: 'pan-con-tomate' })).statusCode).toBe(401);
    const ok = await send('POST', '/api/login', { email: ' CARTERA@example.com ', password: 'pan-con-tomate' });
    expect(ok.statusCode).toBe(200);
    const setCookie = String(ok.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    cookie = setCookie.split(';')[0]!;
    expect((await get('/api/lists')).statusCode).toBe(200);
    expect((await get('/api/session')).json()).toMatchObject({ authRequired: true, authenticated: true, googleEnabled: false });
  });

  it('una cookie manipulada no vale', async () => {
    cookie = `wl_sesion=${Date.now() + 1e9}.abc.firma-falsa`;
    expect((await get('/api/lists')).statusCode).toBe(401);
  });

  it('bloquea tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) await send('POST', '/api/login', { email: ownerEmail, password: 'mal' });
    expect((await send('POST', '/api/login', { email: ownerEmail, password: 'pan-con-tomate' })).statusCode).toBe(429);
  });

  it('rechaza cambios enviados desde otra web', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { name: 'X' },
      headers: { host: 'cartera.test', origin: 'https://malvada.example' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('valores y vista', () => {
  it('crea valores y calcula estado, conversión de divisa y consenso', async () => {
    expect((await send('POST', '/api/items', { listId: 1, symbol: 'aaa.mc', buyPrices: [10.2] })).statusCode).toBe(201);
    expect((await send('POST', '/api/items', { listId: 1, symbol: 'BBB', buyPrices: [40], sharesOverride: 10 })).statusCode).toBe(201);

    const view = (await get('/api/lists/1/watchlist')).json() as WatchlistView;
    const aaa = view.rows.find((r) => r.item.symbol === 'AAA.MC')!;
    const bbb = view.rows.find((r) => r.item.symbol === 'BBB')!;
    expect(aaa.metrics.status).toBe('reached'); // 10 ≤ 10,2
    expect(aaa.targets?.mean).toBe(12);
    expect(aaa.targets?.trailingPE).toBe(18.5);
    expect(view.fx.USD).toBe(1.1);
    expect(bbb.metrics.netBase).toBeCloseTo((10 * 40) / 1.1, 6); // importe en euros
    expect(bbb.metrics.status).toBe('far'); // le falta caer un 20 % (límite de «lejos»)
  });

  it('valida los datos con mensajes en español', async () => {
    const res = await send('POST', '/api/items', { listId: 1, symbol: '', buyPrices: [-1] });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/Demasiado pequeño|mayor/);
  });

  it('edita y borra', async () => {
    const { id } = (await send('POST', '/api/items', { listId: 1, symbol: 'AAA.MC' })).json() as { id: number };
    const patched = (await send('PATCH', `/api/items/${id}`, { notes: 'vigilar' })).json() as { notes: string };
    expect(patched.notes).toBe('vigilar');
    expect((await send('DELETE', `/api/items/${id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `/api/items/${id}`)).statusCode).toBe(404);
  });
});

describe('ajustes', () => {
  it('guarda cambios parciales y rechaza valores no válidos', async () => {
    const s = (await send('PUT', '/api/settings', { bands: { veryNear: 3, near: 8, far: 25 }, theme: 'dark' })).json() as Settings;
    expect(s.bands).toEqual({ veryNear: 3, near: 8, far: 25 });
    expect(s.statusNames.veryNear).toBe('Muy cerca');
    expect(s.theme).toBe('dark');
    const named = (await send('PUT', '/api/settings', { statusNames: { ...s.statusNames, veryNear: 'A tiro', far: '' } })).json() as Settings;
    expect(named.statusNames.veryNear).toBe('A tiro');
    expect(named.statusNames.far).toBe('Lejos'); // vacío: vuelve al de serie
    expect((await send('PUT', '/api/settings', { theme: 'rosa' })).statusCode).toBe(400);
  });

  it('pasa los ajustes antiguos (cerca 5 % / lejos 15 %) a los cinco tramos con sus colores', async () => {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('nearThresholdPct', '5'::jsonb), ('farThresholdPct', '15'::jsonb), ('colors', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify({ ...DEFAULT_COLORS, near: '#d97706', far: '#64748b', fx: '#123456' })],
    );
    const s = (await get('/api/settings')).json() as Settings;
    expect(s.bands).toEqual(DEFAULT_SETTINGS.bands);
    expect(s.colors.near).toBe(DEFAULT_COLORS.near);
    expect(s.colors.far).toBe(DEFAULT_COLORS.far);
    expect(s.colors.fx).toBe('#123456'); // los demás colores elegidos se respetan
    await send('PUT', '/api/settings', { theme: 'light' });
    const keys = (await db.query<{ key: string }>('SELECT key FROM settings')).map((r) => r.key);
    expect(keys).not.toContain('nearThresholdPct');
    expect(keys).toContain('bands');
  });
});

describe('copias', () => {
  it('importar guarda antes una copia de lo que había y se puede restaurar', async () => {
    await send('POST', '/api/items', { listId: 1, symbol: 'AAA.MC' });
    const res = (await send('POST', '/api/backup', { version: 1, lists: [{ name: 'Nueva', items: [] }] })).json() as {
      savedTo: string | null;
    };
    expect(res.savedTo).toBeTruthy();
    const snaps = (await get('/api/snapshots')).json() as { id: number; reason: string; items: number }[];
    expect(snaps[0]).toMatchObject({ reason: 'antes de importar', items: 1 });
    await send('POST', `/api/snapshots/${snaps[0]!.id}/restore`);
    const lists = (await get('/api/lists')).json() as { name: string; itemCount: number }[];
    expect(lists).toEqual([expect.objectContaining({ name: 'Vigilar nuevas', itemCount: 1 })]);
  });

  it('un nombre de lista repetido da un error claro', async () => {
    const res = await send('POST', '/api/lists', { name: 'Vigilar nuevas' });
    expect(res.statusCode).toBe(409);
  });
});

describe('límite de Yahoo', () => {
  it('ante un 429 pausa las consultas y sirve los últimos precios guardados', async () => {
    await send('POST', '/api/items', { listId: 1, symbol: 'AAA.MC' });
    await get('/api/lists/1/watchlist'); // primera consulta: queda guardada
    provider.failWith = 'Too Many Requests (429)';
    const view = (await get('/api/lists/1/watchlist?force=1')).json() as WatchlistView;
    expect(view.throttledUntil).toBeTruthy();
    expect(view.rows[0]!.quote?.stale).toBe(true);
    const calls = provider.calls;
    await get('/api/lists/1/watchlist?force=1');
    expect(provider.calls).toBe(calls); // en pausa: no se vuelve a preguntar
  });
});

describe('históricos', () => {
  it('devuelve el histórico de un periodo y los minigráficos', async () => {
    const h = (await get('/api/market/history/aaa.mc?range=6m')).json() as { points: { c: number }[]; stale: boolean };
    expect(h.points.map((p) => p.c)).toEqual([10, 11, 9.5, 10.2]);
    expect(h.stale).toBe(false);
    expect((await get('/api/market/history/AAA.MC?range=10y')).statusCode).toBe(400);
    const s = (await get('/api/market/sparklines?symbols=AAA.MC,BBB')).json() as Record<string, number[]>;
    expect(Object.keys(s).sort()).toEqual(['AAA.MC', 'BBB']);
  });
});

describe('cartera', () => {
  const buy = (ticker: string, shares: number, amountEur: number, date = '2025-01-10') => ({
    operation: { date, ticker, type: 'buy', shares, amountEur },
  });
  const portfolio = async () => (await get('/api/portfolio')).json() as CarteraView;

  it('registra operaciones, crea el valor y devuelve precios solo de lo que sigue en cartera', async () => {
    expect((await send('POST', '/api/operations', { ...buy('aaa', 100, 800), instrument: { symbol: 'AAA.MC' } })).statusCode).toBe(201);
    await send('POST', '/api/operations', { ...buy('BBB', 10, 400), instrument: { symbol: 'BBB', currency: 'USD' } });
    await send('POST', '/api/operations', { operation: { date: '2025-03-01', ticker: 'BBB', type: 'sell', shares: 10, amountEur: 480 } });
    const view = await portfolio();
    expect(view.operations.map((o) => o.ticker)).toEqual(['AAA', 'BBB', 'BBB']);
    expect(view.instruments.map((i) => [i.ticker, i.symbol])).toEqual([
      ['AAA', 'AAA.MC'],
      ['BBB', 'BBB'],
    ]);
    expect(Object.keys(view.quotes)).toEqual(['AAA.MC']);
    expect(view.fx.EUR).toBe(1);
  });

  it('no deja guardar ventas de más ni borrar una compra que ya se vendió', async () => {
    const b = (await send('POST', '/api/operations', buy('AAA', 10, 100))).json() as { id: number };
    const res = await send('POST', '/api/operations', { operation: { date: '2025-02-01', ticker: 'AAA', type: 'sell', shares: 20, amountEur: 300 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/solo hay 10/);
    await send('POST', '/api/operations', { operation: { date: '2025-02-01', ticker: 'AAA', type: 'sell', shares: 10, amountEur: 150 } });
    expect((await send('DELETE', `/api/operations/${b.id}`)).statusCode).toBe(400);
    expect((await portfolio()).operations).toHaveLength(2);
  });

  it('edita, cambia el bróker de varias y borra', async () => {
    const a = (await send('POST', '/api/operations', buy('AAA', 10, 100))).json() as { id: number };
    const c = (await send('POST', '/api/operations', buy('AAA', 5, 60, '2025-02-01'))).json() as { id: number };
    const edited = await send('PUT', `/api/operations/${a.id}`, { date: '2025-01-10', ticker: 'AAA', type: 'buy', shares: 12, amountEur: 120 });
    expect(edited.json()).toMatchObject({ shares: 12, amountEur: 120 });
    expect((await send('POST', '/api/operations/broker', { ids: [a.id, c.id], broker: 'ING' })).json()).toEqual({ updated: 2 });
    expect((await portfolio()).operations.every((o) => o.broker === 'ING')).toBe(true);
    expect((await send('DELETE', `/api/operations/${c.id}`)).statusCode).toBe(204);
    expect((await send('PUT', '/api/instruments/AAA', { sector: 'Industria', name: 'Triple A' })).json()).toMatchObject({ sector: 'Industria', name: 'Triple A' });
  });

  it('importar sustituye lo importado antes, conserva lo manual y guarda una copia', async () => {
    await send('POST', '/api/operations', buy('MAN', 1, 10));
    const excel = {
      instruments: [{ ticker: 'AAA', symbol: 'AAA.MC' }],
      operations: [
        { date: '2020-01-01', ticker: 'AAA', type: 'buy', shares: 10, amountEur: 100, sourceRef: 1 },
        { date: '2021-01-01', ticker: 'AAA', type: 'dividend', amountEur: 5, sourceRef: 2 },
      ],
    };
    expect((await send('POST', '/api/portfolio/import', excel)).json()).toMatchObject({ imported: 2, replaced: 0 });
    const again = (await send('POST', '/api/portfolio/import', excel)).json() as { replaced: number; savedTo: number };
    expect(again.replaced).toBe(2);
    expect(again.savedTo).toBeGreaterThan(0);
    const view = await portfolio();
    expect(view.operations.map((o) => [o.ticker, o.source])).toEqual([
      ['AAA', 'excel'],
      ['AAA', 'excel'],
      ['MAN', 'manual'],
    ]);
    const bad = await send('POST', '/api/portfolio/import', {
      instruments: [],
      operations: [{ date: '2020-01-01', ticker: 'X', type: 'sell', shares: 1, amountEur: 1 }],
    });
    expect(bad.statusCode).toBe(400);
    expect((await portfolio()).operations).toHaveLength(3);
  });

  it('la copia de seguridad incluye la cartera y una copia antigua no la borra', async () => {
    await send('POST', '/api/operations', buy('AAA', 5, 45));
    const backup = (await get('/api/backup')).json() as { portfolio: { operations: unknown[] } };
    expect(backup.portfolio.operations).toHaveLength(1);
    await send('POST', '/api/backup', { version: 1, lists: [{ name: 'Vieja', items: [] }], positions: [{ symbol: 'OLD' }] });
    expect((await portfolio()).operations).toHaveLength(1);
    await send('POST', '/api/backup', { ...backup, portfolio: { instruments: [], operations: [] } });
    expect((await portfolio()).operations).toHaveLength(0);
  });

  it('rellena el sector desde la ficha de la empresa', async () => {
    await send('POST', '/api/operations', { ...buy('BBB', 1, 40), instrument: { symbol: 'BBB' } });
    await portfolio();
    await new Promise((r) => setTimeout(r, 50));
    expect((await portfolio()).instruments[0]).toMatchObject({ sector: 'Tecnología', name: 'BBB S.A.' });
  });
});

describe('importar desde Excel/CSV', () => {
  it('crea los nuevos y en los existentes solo cambia lo que trae el fichero', async () => {
    await send('POST', '/api/items', { listId: 1, symbol: 'AAA.MC', buyPrices: [9], notes: 'mi nota' });
    const res = await send('POST', '/api/lists/1/import', {
      items: [
        { symbol: 'AAA.MC', buyPrices: [8.5, 7.6], brokerTarget: 14 },
        { symbol: 'bbb', investAmount: 3000, orderActive: true, orderUntil: '2026-12-31' },
      ],
    });
    expect(res.json()).toEqual({ created: 1, updated: 1 });
    const view = (await get('/api/lists/1/watchlist')).json() as WatchlistView;
    const aaa = view.rows.find((r) => r.item.symbol === 'AAA.MC')!.item;
    expect(aaa.buyPrices).toEqual([8.5, 7.6]);
    expect(aaa.notes).toBe('mi nota');
    expect(view.rows.find((r) => r.item.symbol === 'BBB')!.item.orderUntil).toBe('2026-12-31');
  });

  it('si una fila no es válida no importa nada', async () => {
    const res = await send('POST', '/api/lists/1/import', { items: [{ symbol: 'AAA.MC' }, { symbol: 'BBB', buyPrices: [-1] }] });
    expect(res.statusCode).toBe(400);
    expect(((await get('/api/lists/1/watchlist')).json() as WatchlistView).rows).toHaveLength(0);
  });
});

describe('avisos en el servidor', () => {
  it('detecta la zona de compra, lo guarda en el historial y no lo repite', async () => {
    await send('POST', '/api/items', { listId: 1, symbol: 'AAA.MC', buyPrices: [10.2] });
    expect((await send('POST', '/api/alerts/check')).json()).toEqual({ alerts: 1 });
    expect((await send('POST', '/api/alerts/check')).json()).toEqual({ alerts: 0 });
    const history = (await get('/api/alerts')).json() as { kind: string; symbol: string }[];
    expect(history).toEqual([expect.objectContaining({ kind: 'reached', symbol: 'AAA.MC' })]);
  });

  it('sin claves VAPID las notificaciones no se pueden activar', async () => {
    expect((await get('/api/push/key')).json()).toEqual({ publicKey: null, enabled: false });
    const res = await send('POST', '/api/push/subscribe', {
      subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } },
    });
    expect(res.statusCode).toBe(503);
  });
});
