/**
 * Tests de la API de punta a punta (Fastify inject) con un Postgres en memoria (PGlite) y un
 * proveedor de cotizaciones simulado: no dependen de internet, de Neon ni de Yahoo.
 */
import type { PortfolioView, WatchlistView } from '@watchlist/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
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
}

let provider: FakeProvider;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

async function setup(auth?: { password: string; secret: string; secure: boolean }) {
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
  beforeEach(async () => {
    await app.close();
    await db.close();
    await setup({ password: 'pan-con-tomate', secret: 'x'.repeat(32), secure: true });
  });

  it('sin entrar no se ven los datos; con la contraseña sí', async () => {
    expect((await get('/api/lists')).statusCode).toBe(401);
    expect((await get('/api/health')).statusCode).toBe(200);
    expect((await get('/api/session')).json()).toEqual({ authRequired: true, authenticated: false });
    expect((await send('POST', '/api/login', { password: 'otra' })).statusCode).toBe(401);
    const ok = await send('POST', '/api/login', { password: 'pan-con-tomate' });
    expect(ok.statusCode).toBe(200);
    const setCookie = String(ok.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    cookie = setCookie.split(';')[0]!;
    expect((await get('/api/lists')).statusCode).toBe(200);
    expect((await get('/api/session')).json()).toEqual({ authRequired: true, authenticated: true });
  });

  it('una cookie manipulada no vale', async () => {
    cookie = `wl_sesion=${Date.now() + 1e9}.abc.firma-falsa`;
    expect((await get('/api/lists')).statusCode).toBe(401);
  });

  it('bloquea tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) await send('POST', '/api/login', { password: 'mal' });
    expect((await send('POST', '/api/login', { password: 'pan-con-tomate' })).statusCode).toBe(429);
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
    expect(bbb.metrics.status).toBe('veryFar'); // le falta caer un 20 %
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
    const s = (await send('PUT', '/api/settings', { nearThresholdPct: 3, theme: 'dark' })).json() as { nearThresholdPct: number; farThresholdPct: number; theme: string };
    expect(s.nearThresholdPct).toBe(3);
    expect(s.farThresholdPct).toBe(15);
    expect(s.theme).toBe('dark');
    expect((await send('PUT', '/api/settings', { theme: 'rosa' })).statusCode).toBe(400);
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
  it('calcula valor, plusvalía, peso y estado del objetivo de venta', async () => {
    expect((await send('POST', '/api/positions', { symbol: 'aaa.mc', shares: 100, avgPrice: 8, sellTarget: 10.2 })).statusCode).toBe(201);
    // 10 acciones de BBB a 44 USD (pagaste 400 € en total); hoy cotiza a 50 USD con el cambio a 1,1.
    expect((await send('POST', '/api/positions', { symbol: 'BBB', shares: 10, avgPrice: 44, costBase: 400 })).statusCode).toBe(201);
    expect((await send('POST', '/api/positions', { symbol: 'BBB', shares: 1, avgPrice: 1 })).statusCode).toBe(409);

    const view = (await get('/api/portfolio')).json() as PortfolioView;
    const aaa = view.rows.find((r) => r.position.symbol === 'AAA.MC')!;
    expect(aaa.metrics.valueBase).toBeCloseTo(1000);
    expect(aaa.metrics.pnlBase).toBeCloseTo(200);
    expect(aaa.metrics.pnlPct).toBeCloseTo(0.25);
    expect(aaa.metrics.sellStatus).toBe('near'); // le falta un 2 % (umbral por defecto 3 %)
    const bbb = view.rows.find((r) => r.position.symbol === 'BBB')!;
    expect(bbb.metrics.valueBase).toBeCloseTo(500 / 1.1);
    expect(bbb.metrics.pnlBase).toBeCloseTo(500 / 1.1 - 400);
    expect(view.totals.valueBase).toBeCloseTo(1000 + 500 / 1.1);
    expect(aaa.metrics.weight! + bbb.metrics.weight!).toBeCloseTo(1);
  });

  it('una compra nueva recalcula el precio medio y vender todo borra la posición', async () => {
    const pos = (await send('POST', '/api/positions', { symbol: 'AAA.MC', shares: 100, avgPrice: 8 })).json() as { id: number };
    const after = (await send('POST', `/api/positions/${pos.id}/trade`, { type: 'buy', shares: 100, price: 10 })).json() as {
      shares: number;
      avgPrice: number;
    };
    expect(after.shares).toBe(200);
    expect(after.avgPrice).toBeCloseTo(9);
    expect((await send('POST', `/api/positions/${pos.id}/trade`, { type: 'sell', shares: 500 })).statusCode).toBe(400);
    const sold = (await send('POST', `/api/positions/${pos.id}/trade`, { type: 'sell', shares: 50 })).json() as { shares: number; avgPrice: number };
    expect(sold.shares).toBe(150);
    expect(sold.avgPrice).toBeCloseTo(9);
    expect((await send('POST', `/api/positions/${pos.id}/trade`, { type: 'sell', shares: 150 })).json()).toEqual({ deleted: true });
    expect(((await get('/api/portfolio')).json() as PortfolioView).rows).toHaveLength(0);
  });

  it('la copia de seguridad incluye la cartera y una copia antigua no la borra', async () => {
    await send('POST', '/api/positions', { symbol: 'AAA.MC', shares: 5, avgPrice: 9 });
    const backup = (await get('/api/backup')).json() as { positions: unknown[] };
    expect(backup.positions).toHaveLength(1);
    await send('POST', '/api/backup', { version: 1, lists: [{ name: 'Vieja', items: [] }] });
    expect(((await get('/api/portfolio')).json() as PortfolioView).rows).toHaveLength(1);
    await send('POST', '/api/backup', { ...backup, positions: [] });
    expect(((await get('/api/portfolio')).json() as PortfolioView).rows).toHaveLength(0);
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
