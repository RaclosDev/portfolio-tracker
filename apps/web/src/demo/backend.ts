/**
 * Servidor de demostración: vive en el navegador y responde a las mismas rutas que la API real.
 * Los datos son ficticios y los cambios se pierden al recargar. Los cálculos usan el mismo código
 * compartido que el servidor (`@watchlist/shared`), así que las pantallas se comportan igual.
 */
import {
  bulkBrokerSchema,
  carteraImportSchema,
  computeLedger,
  computeMetrics,
  computePortfolioHistory,
  DEFAULT_SETTINGS,
  importRequestSchema,
  instrumentInputSchema,
  instrumentPatchSchema,
  itemInputSchema,
  itemPatchSchema,
  listInputSchema,
  operationFingerprint,
  operationInputSchema,
  portfolioHistoryQuerySchema,
  settingsPatchSchema,
  settingsSchema,
  shiftDate,
  type AnalystTargets,
  type Instrument,
  type Item,
  type Operation,
  type OperationInput,
  type Quote,
  type Settings,
} from '@watchlist/shared';

class DemoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
const daysAgo = (days: number) => shiftDate(today(), -days);
const round = (value: number, decimals = 2) => +value.toFixed(decimals);

type Kind = 'EQUITY' | 'ETF';
interface Security {
  symbol: string; name: string; price: number; changePct: number; currency: 'EUR' | 'USD';
  kind: Kind; exchange: string; sector: string; isin: string;
}
const security = (symbol: string, name: string, price: number, changePct: number, sector: string, isin: string, kind: Kind = 'EQUITY'): Security => ({
  symbol, name, price, changePct, sector, isin, kind,
  currency: symbol.includes('.') ? 'EUR' : 'USD',
  exchange: symbol.endsWith('.MC') ? 'BME' : symbol.endsWith('.DE') ? 'XETRA' : ['JPM', 'KO', 'V', 'LLY', 'BRK-B'].includes(symbol) ? 'NYSE' : 'NASDAQ',
});

// Empresas reales con precios, niveles y operaciones inventados.
const SPAIN = [
  security('IBE.MC', 'Iberdrola', 16.42, 0.012, 'Energía', 'ES0000000011'),
  security('SAN.MC', 'Banco Santander', 8.31, 0.008, 'Finanzas', 'ES0000000029'),
  security('ITX.MC', 'Inditex', 49.6, 0.015, 'Consumo', 'ES0000000037'),
  security('BBVA.MC', 'BBVA', 15.2, 0.009, 'Finanzas', 'ES0000000045'),
  security('REP.MC', 'Repsol', 14.9, 0.003, 'Energía', 'ES0000000052'),
  security('TEF.MC', 'Telefónica', 4.12, -0.006, 'Telecomunicaciones', 'ES0000000060'),
  security('AENA.MC', 'Aena', 23.4, 0.004, 'Industria', 'ES0000000078'),
  security('CABK.MC', 'CaixaBank', 8.9, -0.011, 'Finanzas', 'ES0000000086'),
  security('FER.MC', 'Ferrovial', 52.1, 0.006, 'Industria', 'ES0000000094'),
  security('AMS.MC', 'Amadeus IT Group', 66.3, -0.004, 'Tecnología', 'ES0000000102'),
];
const USA = [
  security('AAPL', 'Apple', 228.4, 0.006, 'Tecnología', 'US0000000018'),
  security('MSFT', 'Microsoft', 431.2, -0.007, 'Tecnología', 'US0000000026'),
  security('NVDA', 'NVIDIA', 142.6, 0.021, 'Tecnología', 'US0000000034'),
  security('GOOGL', 'Alphabet', 176.9, 0.011, 'Comunicación', 'US0000000042'),
  security('AMZN', 'Amazon', 205.3, -0.003, 'Consumo', 'US0000000059'),
  security('META', 'Meta Platforms', 588.1, 0.014, 'Comunicación', 'US0000000067'),
  security('BRK-B', 'Berkshire Hathaway', 468.5, 0.002, 'Finanzas', 'US0000000075'),
  security('JPM', 'JPMorgan Chase', 242.7, 0.005, 'Finanzas', 'US0000000083'),
  security('LLY', 'Eli Lilly', 812.4, -0.018, 'Salud', 'US0000000091'),
  security('AVGO', 'Broadcom', 181.3, 0.017, 'Tecnología', 'US0000000109'),
  security('V', 'Visa', 309.8, 0.001, 'Finanzas', 'US0000000117'),
  security('KO', 'Coca-Cola', 63.2, -0.002, 'Consumo', 'US0000000125'),
];
const FUNDS = [
  security('VWCE.DE', 'Vanguard FTSE All-World', 128.4, 0.004, 'ETF global', 'IE0000000013', 'ETF'),
  security('SXR8.DE', 'iShares Core S&P 500', 562.7, 0.005, 'ETF EE. UU.', 'IE0000000021', 'ETF'),
];
const CATALOG = new Map([...SPAIN, ...USA, ...FUNDS].map((s) => [s.symbol, s]));
const FX: Record<string, number> = { EUR: 1, USD: 1.09 };

const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);
/** Precio ficticio de un valor hace `days` días: una tendencia con algo de oscilación, estable entre llamadas. */
function priceAt(symbol: string, days: number): number {
  const s = CATALOG.get(symbol);
  if (!s) return 0;
  const h = hash(symbol);
  const growth = 0.04 + (h % 30) / 100;
  const wave = (d: number) => 1 + 0.035 * Math.sin(d / 11 + h) + 0.018 * Math.sin(d / 3.7 + 2 * h);
  return s.price * Math.exp((-growth * days) / 365) * (wave(days) / wave(0));
}
const fxAt = (days: number) => 1.09 + 0.035 * Math.sin(days / 50);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

function quoteOf(symbol: string): Quote | undefined {
  const s = CATALOG.get(symbol);
  if (!s) return undefined;
  const year = Array.from({ length: 52 }, (_, week) => priceAt(symbol, week * 7));
  return {
    symbol, name: s.name, currency: s.currency, price: s.price, changePct: s.changePct,
    previousClose: round(s.price / (1 + s.changePct), 4), low52: round(Math.min(...year) * 0.97), high52: round(Math.max(...year) * 1.03),
    quoteType: s.kind, exchange: s.exchange, marketState: 'REGULAR', fetchedAt: new Date().toISOString(),
    source: 'Demo', isin: s.isin, stale: false,
  };
}
function targetsOf(symbol: string): AnalystTargets | null {
  const s = CATALOG.get(symbol);
  if (!s || s.kind === 'ETF') return null;
  const h = hash(symbol);
  return {
    mean: round(s.price * (1.06 + (h % 14) / 100)), median: round(s.price * (1.05 + (h % 12) / 100)),
    high: round(s.price * 1.31), low: round(s.price * 0.88), analysts: 12 + (h % 20),
    recommendation: h % 3 === 0 ? 'hold' : 'buy', recommendationMean: round(1.6 + (h % 12) / 10, 1),
    nextEarnings: shiftDate(today(), 9 + (h % 60)), exDividend: shiftDate(today(), 14 + (h % 80)),
    dividendYield: ['NVDA', 'AMZN', 'META', 'GOOGL', 'BRK-B'].includes(symbol) ? null : round(0.012 + (h % 35) / 1000, 4),
    trailingPE: round(11 + (h % 240) / 10, 1), marketCap: Math.round(s.price * (4 + (h % 90)) * 1e8),
    fetchedAt: new Date().toISOString(),
  };
}

// Estado en memoria -------------------------------------------------------------------------------
const stamp = () => new Date().toISOString();
let settings: Settings = { ...DEFAULT_SETTINGS };
let lists = [{ id: 1, name: 'Bolsa española' }, { id: 2, name: 'S&P 500' }, { id: 3, name: 'ETF' }];
let items: Item[] = [];
let instruments: Instrument[] = [];
let operations: Operation[] = [];
let nextId = 1;
const id = () => nextId++;

// Cada valor queda a una distancia distinta de su primer nivel para que se vean todos los estados.
const LEVELS = [1.002, 0.985, 0.962, 0.93, 0.975, 0.88, 1.01, 0.95, 0.79, 0.99, 0.91, 0.968];
function seedItem(listId: number, s: Security, index: number) {
  const first = round(s.price * LEVELS[index % LEVELS.length]!);
  const order = index === 4;
  items.push({
    id: id(), createdAt: stamp(), updatedAt: stamp(),
    ...itemInputSchema.parse({
      listId, symbol: s.symbol, name: s.name, buyPrices: [first, round(first * 0.94)],
      brokerTarget: round(s.price * 1.18), brokerName: index % 2 ? 'MyInvestor' : 'ING', investAmount: 1500,
      orderActive: order, orderPrice: order ? first : null, orderUntil: order ? shiftDate(today(), 21) : null,
      notes: index === 1 ? 'Esperar a los resultados del trimestre antes de ampliar.' : index === 6 ? 'Segunda compra solo si pierde el soporte.' : null,
    }),
  });
}
SPAIN.forEach((s, i) => seedItem(1, s, i));
USA.forEach((s, i) => seedItem(2, s, i + 3));
FUNDS.forEach((s, i) => seedItem(3, s, i + 7));

const BROKERS = ['ING', 'MyInvestor', 'Interactive Brokers'];
const HELD: [string, number][] = [
  ['IBE.MC', 320], ['SAN.MC', 900], ['ITX.MC', 85], ['REP.MC', 260], ['AAPL', 22], ['MSFT', 14],
  ['NVDA', 40], ['GOOGL', 30], ['JPM', 18], ['KO', 70], ['VWCE.DE', 62], ['SXR8.DE', 12],
];
const NO_DIVIDEND = new Set(['NVDA', 'GOOGL', 'VWCE.DE', 'SXR8.DE']);
function seedOperation(input: OperationInput) {
  operations.push({ id: id(), createdAt: stamp(), updatedAt: stamp(), ...operationInputSchema.parse(input) });
}
HELD.forEach(([ticker, shares], index) => {
  const s = CATALOG.get(ticker)!;
  const broker = BROKERS[index % BROKERS.length]!;
  instruments.push(instrumentInputSchema.parse({ ticker, symbol: ticker, name: s.name, sector: s.sector, currency: s.currency, isin: s.isin }));
  const trade = (type: 'buy' | 'sell', days: number, quantity: number) => {
    const fxRate = s.currency === 'USD' ? round(fxAt(days), 4) : 1;
    const price = round(priceAt(ticker, days));
    const gross = (quantity * price) / fxRate;
    seedOperation({ ticker, date: daysAgo(days), type, shares: quantity, price, fxRate, fees: 2, amountEur: round(type === 'buy' ? gross + 2 : gross - 2), broker });
  };
  const first = Math.round(shares * 0.6);
  trade('buy', 520 - index * 17, first);
  trade('buy', 210 - index * 9, shares - first);
  if (index % 4 === 2) trade('sell', 48 + index, Math.round(shares * 0.25));
  if (!NO_DIVIDEND.has(ticker)) {
    for (const days of [300 - index * 6, 118 - index * 4, 27 + index]) {
      const gross = round(shares * s.price * 0.008 / FX[s.currency]!);
      seedOperation({
        ticker, date: daysAgo(days), type: 'dividend', amountEur: gross, broker,
        withholdingEs: round(gross * (s.currency === 'USD' ? 0.04 : 0.19)), withholdingForeign: s.currency === 'USD' ? round(gross * 0.15) : null,
      });
    }
  }
});

// Vistas ------------------------------------------------------------------------------------------
const listView = (list: { id: number; name: string }) => ({ ...list, itemCount: items.filter((i) => i.listId === list.id).length });
function watchlistView(listId: number) {
  const list = lists.find((l) => l.id === listId);
  if (!list) throw new DemoError(404, 'Lista no encontrada');
  const rows = items.filter((i) => i.listId === listId).map((item) => {
    const quote = quoteOf(item.symbol) ?? null;
    const targets = targetsOf(item.symbol);
    return {
      item: { ...item, name: item.name ?? quote?.name ?? null }, quote, targets,
      metrics: computeMetrics({ item, quote, targets, fxRate: quote?.currency ? FX[quote.currency] ?? null : null, settings, today: today() }),
    };
  });
  return { list: listView(list), settings, rows, fx: FX, generatedAt: stamp() };
}
function portfolioView() {
  const quotes: Record<string, Quote> = {};
  for (const i of instruments) {
    const quote = i.symbol ? quoteOf(i.symbol) : undefined;
    if (quote && i.symbol) quotes[i.symbol] = quote;
  }
  return { instruments, operations, quotes, fx: FX, generatedAt: stamp() };
}
function portfolioHistory(query: unknown) {
  const { from, to } = portfolioHistoryQuerySchema.parse(query);
  if (to > today()) throw new DemoError(400, 'El histórico no admite fechas futuras');
  const dates: string[] = [];
  for (let date = shiftDate(from, -7); date <= to; date = shiftDate(date, 1)) dates.push(date);
  const prices = Object.fromEntries(instruments.filter((i) => i.symbol && CATALOG.has(i.symbol)).map((i) => [i.symbol!, {
    currency: i.currency, points: dates.map((t) => ({ t, c: priceAt(i.symbol!, dayDiff(t, today())) })),
  }]));
  const fx = { USD: dates.map((t) => ({ t, c: fxAt(dayDiff(t, today())) })) };
  return { from, to, points: computePortfolioHistory({ from, to, operations, instruments, prices, fx }), stale: false, missing: [] };
}
const RANGE_DAYS = { '1m': 30, '3m': 91, '6m': 182, '1y': 365, '5y': 1825 } as const;
function history(symbol: string, range: string) {
  if (!CATALOG.has(symbol)) throw new DemoError(404, `Símbolo ${symbol} no encontrado`);
  const days = RANGE_DAYS[range as keyof typeof RANGE_DAYS] ?? 365;
  const step = days > 400 ? 7 : 1;
  const points = [];
  for (let d = days; d >= 0; d -= step) points.push({ t: daysAgo(d), c: round(priceAt(symbol, d), 4) });
  return { points, stale: false };
}
function sparklines(symbols: string[], range: string) {
  const days = range === '1y' ? 365 : 91;
  return Object.fromEntries(symbols.filter((s) => CATALOG.has(s)).map((symbol) => [symbol,
    Array.from({ length: 40 }, (_, i) => round(priceAt(symbol, Math.round(days * (1 - i / 39))), 4))]));
}
const matches = (q: string) => {
  const text = q.trim().toLowerCase();
  return [...CATALOG.values()].filter((s) => s.symbol.toLowerCase().includes(text) || s.name.toLowerCase().includes(text) || s.isin.toLowerCase() === text);
};
const asResult = (s: Security) => ({ symbol: s.symbol, name: s.name, exchange: s.exchange, type: s.kind });

function assertLedger(next: Operation[]) {
  const { issues } = computeLedger(next, instruments);
  if (issues.length) throw new DemoError(400, issues.map((i) => i.message).join(' '));
}
function ensureInstrument(ticker: string, patch?: unknown) {
  let current = instruments.find((i) => i.ticker === ticker);
  if (!current) {
    const s = CATALOG.get(ticker);
    current = instrumentInputSchema.parse({ ticker, symbol: s ? ticker : null, name: s?.name, sector: s?.sector, currency: s?.currency, isin: s?.isin });
    instruments = [...instruments, current];
  }
  if (patch) {
    const updated = instrumentInputSchema.parse({ ...current, ...instrumentPatchSchema.parse(patch), ticker });
    instruments = instruments.map((i) => (i.ticker === ticker ? updated : i));
  }
}
function saveOperation(body: { operation?: unknown; instrument?: unknown }, operationId?: number) {
  const data = operationInputSchema.parse(body.operation ?? body);
  const existing = operationId == null ? undefined : operations.find((o) => o.id === operationId);
  if (operationId != null && !existing) throw new DemoError(404, 'Operación no encontrada');
  const op: Operation = { ...data, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? stamp(), updatedAt: stamp() };
  const next = existing ? operations.map((o) => (o.id === op.id ? op : o)) : [...operations, op];
  assertLedger(next);
  operations = next;
  ensureInstrument(data.ticker, body.instrument);
  return op;
}

const NOT_IN_DEMO = 'No disponible en la demo: crea una cuenta para usarlo con tus datos.';

function handle(method: string, url: URL, body: unknown): unknown {
  const path = decodeURIComponent(url.pathname);
  const query = Object.fromEntries(url.searchParams);
  const route = `${method} ${path}`;
  const numeric = (prefix: string, suffix = '') => {
    const match = new RegExp(`^${prefix}/(\\d+)${suffix}$`).exec(path);
    return match ? Number(match[1]) : null;
  };
  const symbolsOf = (value?: string) => [...new Set((value ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))];

  switch (route) {
    case 'GET /api/health': return { ok: true, version: 'demo' };
    case 'GET /api/session': return {
      authRequired: true, authenticated: true, googleEnabled: false, registrationEnabled: false,
      user: { id: 'demo', email: 'demo@portfolio-tracker.example', googleLinked: false },
    };
    case 'POST /api/logout': return { ok: true };
    case 'GET /api/settings': return settings;
    case 'PUT /api/settings': return (settings = settingsSchema.parse({ ...settings, ...settingsPatchSchema.parse(body) }));
    case 'GET /api/lists': return lists.map(listView);
    case 'POST /api/lists': {
      const { name } = listInputSchema.parse(body);
      if (lists.some((l) => l.name === name)) throw new DemoError(409, 'Ya existe uno con ese nombre o símbolo');
      const list = { id: Math.max(...lists.map((l) => l.id)) + 1, name };
      lists = [...lists, list];
      return listView(list);
    }
    case 'POST /api/items': {
      const data = itemInputSchema.parse(body);
      if (!lists.some((l) => l.id === data.listId)) throw new DemoError(404, 'Lista no encontrada');
      if (items.some((i) => i.listId === data.listId && i.symbol === data.symbol)) throw new DemoError(409, 'Ya existe uno con ese nombre o símbolo');
      const item: Item = { ...data, id: id(), createdAt: stamp(), updatedAt: stamp() };
      items = [...items, item];
      return item;
    }
    case 'GET /api/portfolio': return portfolioView();
    case 'GET /api/portfolio/history': return portfolioHistory(query);
    case 'POST /api/operations': return saveOperation(body as { operation?: unknown; instrument?: unknown });
    case 'POST /api/operations/broker': {
      const { ids, broker, needsReview } = bulkBrokerSchema.parse(body);
      operations = operations.map((o) => (ids.includes(o.id) ? { ...o, broker, needsReview, updatedAt: stamp() } : o));
      return { updated: ids.length };
    }
    case 'POST /api/portfolio/import': {
      const data = carteraImportSchema.parse(body);
      const seen = new Set(operations.map(operationFingerprint));
      const additions = data.operations.filter((op) => {
        const key = operationFingerprint(op);
        if (!data.allowDuplicates && seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!additions.length) return { imported: 0, skipped: data.operations.length, savedTo: null };
      const created: Operation[] = additions.map((op) => ({ ...op, source: 'excel', id: id(), createdAt: stamp(), updatedAt: stamp() }));
      assertLedger([...operations, ...created]);
      operations = [...operations, ...created];
      for (const i of data.instruments) if (created.some((op) => op.ticker === i.ticker) && !instruments.some((x) => x.ticker === i.ticker)) instruments = [...instruments, i];
      for (const op of created) ensureInstrument(op.ticker);
      return { imported: created.length, skipped: data.operations.length - created.length, savedTo: null };
    }
    case 'GET /api/market/search': return matches(query.q ?? '').map(asResult);
    case 'GET /api/market/instruments': return matches(query.q ?? '').map((s) => ({ isin: s.isin, name: s.name, type: s.kind }));
    case 'GET /api/market/listings': return [...CATALOG.values()].filter((s) => s.isin === (query.isin ?? '').toUpperCase())
      .map((s) => ({ ...asResult(s), currency: s.currency, price: s.price, priceOnly: false }));
    case 'GET /api/market/quotes': return symbolsOf(query.symbols).map(quoteOf).filter(Boolean);
    case 'GET /api/market/fx': return FX;
    case 'GET /api/market/sparklines': return sparklines(symbolsOf(query.symbols), query.range ?? '3m');
    case 'GET /api/alerts': return [];
    case 'POST /api/alerts/check': return { alerts: 0 };
    case 'GET /api/push/key': return { publicKey: null, enabled: false };
    case 'GET /api/push/devices': return [];
    case 'GET /api/snapshots': return [];
    case 'POST /api/push/unsubscribe': return { ok: true };
    case 'POST /api/push/subscribe':
    case 'POST /api/push/test':
    case 'POST /api/backup':
    case 'POST /api/login':
    case 'POST /api/register':
      throw new DemoError(403, NOT_IN_DEMO);
  }

  const listId = numeric('/api/lists');
  if (listId != null) {
    if (!lists.some((l) => l.id === listId)) throw new DemoError(404, 'Lista no encontrada');
    if (method === 'PATCH') {
      const { name } = listInputSchema.parse(body);
      lists = lists.map((l) => (l.id === listId ? { ...l, name } : l));
      return listView(lists.find((l) => l.id === listId)!);
    }
    if (method === 'DELETE') {
      if (lists.length <= 1) throw new DemoError(400, 'Debe quedar al menos una lista');
      lists = lists.filter((l) => l.id !== listId);
      items = items.filter((i) => i.listId !== listId);
      return undefined;
    }
  }
  const watchlistId = numeric('/api/lists', '/watchlist');
  if (watchlistId != null && method === 'GET') return watchlistView(watchlistId);
  const importId = numeric('/api/lists', '/import');
  if (importId != null && method === 'POST') {
    if (!lists.some((l) => l.id === importId)) throw new DemoError(404, 'Lista no encontrada');
    let created = 0;
    let updated = 0;
    for (const row of importRequestSchema.parse(body).items) {
      const current = items.find((i) => i.listId === importId && i.symbol === row.symbol);
      if (current) {
        const { id: itemId, createdAt, updatedAt: _updatedAt, ...rest } = current;
        const next: Item = { ...itemInputSchema.parse({ ...rest, ...row, listId: importId }), id: itemId, createdAt, updatedAt: stamp() };
        items = items.map((i) => (i.id === itemId ? next : i));
        updated++;
      } else {
        items = [...items, { ...itemInputSchema.parse({ ...row, listId: importId }), id: id(), createdAt: stamp(), updatedAt: stamp() }];
        created++;
      }
    }
    return { created, updated };
  }
  const itemId = numeric('/api/items');
  if (itemId != null) {
    const current = items.find((i) => i.id === itemId);
    if (!current) throw new DemoError(404, 'Valor no encontrado');
    if (method === 'PATCH') {
      const { id: _id, createdAt, updatedAt: _updatedAt, ...rest } = current;
      const next: Item = { ...itemInputSchema.parse({ ...rest, ...itemPatchSchema.parse(body) }), id: itemId, createdAt, updatedAt: stamp() };
      items = items.map((i) => (i.id === itemId ? next : i));
      return next;
    }
    if (method === 'DELETE') {
      items = items.filter((i) => i.id !== itemId);
      return undefined;
    }
  }
  const operationId = numeric('/api/operations');
  if (operationId != null) {
    if (method === 'PUT') return saveOperation(body as { operation?: unknown; instrument?: unknown }, operationId);
    if (method === 'DELETE') {
      if (!operations.some((o) => o.id === operationId)) throw new DemoError(404, 'Operación no encontrada');
      const next = operations.filter((o) => o.id !== operationId);
      assertLedger(next);
      operations = next;
      return undefined;
    }
  }
  if (method === 'PUT' && path.startsWith('/api/instruments/')) {
    const ticker = path.slice('/api/instruments/'.length).toUpperCase();
    if (!instruments.some((i) => i.ticker === ticker)) throw new DemoError(404, 'Valor no encontrado');
    ensureInstrument(ticker, body);
    return instruments.find((i) => i.ticker === ticker);
  }
  if (method === 'GET' && path.startsWith('/api/market/quote/')) {
    const symbol = path.slice('/api/market/quote/'.length).toUpperCase();
    return quoteOf(symbol) ?? (() => { throw new DemoError(404, `Símbolo ${symbol} no encontrado en la demo`); })();
  }
  if (method === 'GET' && path.startsWith('/api/market/history/')) {
    return history(path.slice('/api/market/history/'.length).toUpperCase(), query.range ?? '1y');
  }
  if (method !== 'GET') throw new DemoError(403, NOT_IN_DEMO);
  throw new DemoError(404, 'No encontrado');
}

/** Sustituto de `fetch` para el modo demo: misma forma de respuesta que la API real. */
export async function demoFetch(method: string, url: string, body?: unknown): Promise<Response> {
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  try {
    const data = handle(method, new URL(url, window.location.origin), body);
    return data === undefined ? new Response(null, { status: 204 }) : json(200, data);
  } catch (error) {
    if (error instanceof DemoError) return json(error.status, { error: error.message });
    const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (Array.isArray(issues)) return json(400, { error: 'Datos no válidos', issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    console.error(error);
    return json(500, { error: 'Error interno' });
  }
}
