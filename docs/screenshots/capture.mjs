import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, itemInputSchema } from '../../packages/shared/src/schemas.ts';
import { instrumentInputSchema, operationInputSchema } from '../../packages/shared/src/cartera/schemas.ts';
import { computeMetrics } from '../../packages/shared/src/calc.ts';
import { computePortfolioHistory, shiftDate } from '../../packages/shared/src/cartera/history.ts';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ?? new URL('../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const output = fileURLToPath(new URL('./', import.meta.url));
// Tema de la captura: «light» (por defecto) o «dark».
const THEME = process.argv[3] === 'dark' ? 'dark' : 'light';
const now = '2026-11-11T11:00:00.000Z';
const settings = { ...DEFAULT_SETTINGS, theme: THEME };
const examples = [
  ['IBE.MC', 'Iberdrola', 13.48, 13.5, 0.012, 'Energía', 320],
  ['MSFT', 'Microsoft', 425.6, 410, -0.007, 'Tecnología', 14],
  ['SAN.MC', 'Santander', 5.24, 5.1, 0.008, 'Finanzas', 900],
  ['VWCE.DE', 'Vanguard FTSE All-World', 126.3, 120, 0.004, 'ETF global', 62],
  ['ITX.MC', 'Inditex', 51.9, 48, 0.015, 'Consumo', 85],
  ['ASML.AS', 'ASML Holding', 742.4, 690, -0.011, 'Tecnología', 6],
  ['AAPL', 'Apple', 231.2, 215, 0.006, 'Tecnología', 22],
  ['NVDA', 'NVIDIA', 138.7, 120, 0.021, 'Tecnología', 40],
  ['AIR.PA', 'Airbus', 148.6, 140, -0.004, 'Industria', 28],
  ['MC.PA', 'LVMH', 612.3, 640, -0.018, 'Consumo', 5],
  ['REP.MC', 'Repsol', 12.31, 12.8, 0.003, 'Energía', 260],
  ['SXR8.DE', 'iShares Core S&P 500', 548.9, 520, 0.005, 'ETF EE. UU.', 12],
  ['NOVO-B.CO', 'Novo Nordisk', 96.4, 105, -0.023, 'Salud', 30],
  ['BBVA.MC', 'BBVA', 10.42, 9.6, 0.009, 'Finanzas', 410],
];
const USD = new Set(['MSFT', 'AAPL', 'NVDA']);
const ETF = new Set(['VWCE.DE', 'SXR8.DE']);
const BROKERS = ['ING', 'MyInvestor', 'Interactive Brokers'];
const quotes = Object.fromEntries(examples.map(([symbol, name, price, , changePct]) => [symbol, {
  symbol, name, price, changePct, currency: USD.has(symbol) ? 'USD' : 'EUR',
  previousClose: price / (1 + changePct), low52: price * 0.74, high52: price * 1.12,
  quoteType: ETF.has(symbol) ? 'ETF' : 'EQUITY', exchange: symbol.endsWith('.MC') ? 'BME' : symbol.endsWith('.DE') ? 'XETRA' : symbol.endsWith('.PA') ? 'Euronext París' : symbol.endsWith('.AS') ? 'Euronext Ámsterdam' : symbol.endsWith('.CO') ? 'Nasdaq Copenhague' : 'NASDAQ',
  marketState: 'REGULAR', fetchedAt: now, stale: false,
}]));
const fx = { EUR: 1, USD: 1.09 };
const rows = examples.map(([symbol, name, price, buyPrice], index) => {
  const item = { id: index + 1, ...itemInputSchema.parse({ listId: 1, symbol, name,
    buyPrices: [buyPrice, +(buyPrice * 0.94).toFixed(2)], brokerTarget: +(price * 1.2).toFixed(2),
    investAmount: 1500 }), createdAt: now, updatedAt: now };
  const targets = { mean: price * 1.17, median: price * 1.15, high: price * 1.28, low: price * 0.9,
    analysts: 18, recommendation: 'hold', recommendationMean: 2.4, fetchedAt: now };
  const quote = quotes[symbol];
  return { item, quote, targets, metrics: computeMetrics({ item, quote, targets,
    fxRate: fx[quote.currency], settings, today: '2026-11-11' }) };
});
const instruments = examples.map(([ticker, name, , , , sector]) => instrumentInputSchema.parse({
  ticker, symbol: ticker, name, sector, currency: quotes[ticker].currency,
}));
const operations = examples.flatMap(([ticker, , price, , , , shares], index) => [
  { ticker, date: `2025-${String(1 + index % 12).padStart(2, '0')}-12`, type: 'buy', shares: Math.round(shares * 0.6),
    price: price * 0.78, amountEur: Math.round(shares * 0.6) * price * 0.78 / fx[quotes[ticker].currency], broker: BROKERS[index % 3] },
  { ticker, date: `2026-${String(1 + (index * 5) % 9).padStart(2, '0')}-0${1 + index % 9}`, type: 'buy', shares: shares - Math.round(shares * 0.6),
    price: price * 0.9, amountEur: (shares - Math.round(shares * 0.6)) * price * 0.9 / fx[quotes[ticker].currency], broker: BROKERS[index % 3] },
  { ticker, date: `2026-${String(5 + index % 6).padStart(2, '0')}-15`, type: 'dividend', amountEur: ETF.has(ticker) || ticker === 'NVDA' ? 0 : +(shares * price * 0.011).toFixed(2), broker: BROKERS[index % 3] },
  ...(index % 5 === 2 ? [{ ticker, date: '2026-09-2' + index % 9, type: 'sell', shares: Math.round(shares * 0.25), price: price * 1.04, amountEur: Math.round(shares * 0.25) * price * 1.04 / fx[quotes[ticker].currency], broker: BROKERS[index % 3] }] : []),
  { ticker, date: `2025-${String(6 + index % 6).padStart(2, '0')}-18`, type: 'dividend', amountEur: ETF.has(ticker) || ticker === 'NVDA' ? 0 : +(shares * price * 0.006).toFixed(2), broker: BROKERS[index % 3] },
]).filter((op) => op.amountEur > 0).map((op, index) => ({
  id: index + 1, ...operationInputSchema.parse(op), createdAt: now, updatedAt: now,
}));
const changePctOf = (sym) => examples.find((e) => e[0] === sym)[4];
const list = { id: 1, name: 'Vigilar nuevas', itemCount: rows.length };
const sparks = Object.fromEntries(examples.map(([symbol, , price], index) => [symbol,
  Array.from({ length: 40 }, (_, i) => +(price * (0.9 + (changePctOf(symbol) > 0 ? 1 : -0.6) * i * 0.0028 * (1 + index % 4) / 2 + Math.sin(i * (0.35 + index * 0.13) + index * 2) * 0.025 + Math.sin(i * 1.7 + index) * 0.012)).toFixed(2)),
]));
const responses = {
  '/api/session': { authRequired: false, authenticated: true, googleEnabled: false },
  '/api/health': { ok: true, version: 'showcase' },
  '/api/settings': settings,
  '/api/lists': [list],
  '/api/lists/1/watchlist': { list, settings, rows, fx, generatedAt: now },
  '/api/portfolio': { instruments, operations, quotes, fx, generatedAt: now },
  '/api/market/sparklines': sparks,
  '/api/push/key': { publicKey: null, enabled: false },
  '/api/alerts': [],
};

function historyFixture(from, to) {
  const dates = [];
  for (let date = shiftDate(from, -7); date <= to; date = shiftDate(date, 1)) dates.push(date);
  const prices = Object.fromEntries(examples.map(([symbol, , price], index) => [symbol, {
    currency: quotes[symbol].currency,
    points: dates.map((t, i) => ({ t, c: price * (0.8 + i / dates.length * 0.2 + Math.sin(i / 12 + index) * 0.03) })),
  }]));
  const fx = { USD: dates.map((t, i) => ({ t, c: 1.15 - i / dates.length * 0.06 })) };
  return { from, to, points: computePortfolioHistory({ from, to, operations, instruments, prices, fx }), stale: false, missing: [] };
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: THEME,
    deviceScaleFactor: 2, locale: 'es-ES',
    timezoneId: 'Europe/Madrid', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => { localStorage.setItem('watchlist.tourSeen', '1'); localStorage.setItem('watchlist.cartera.tourSeen', '1'); });
  const failures = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/portfolio/history' && route.request().method() === 'GET') {
      return route.fulfill({ json: historyFixture(url.searchParams.get('from'), url.searchParams.get('to')) });
    }
    if (!(url.pathname in responses) || route.request().method() !== 'GET') {
      failures.push(`${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 501, json: { error: 'Missing screenshot fixture' } });
    }
    return route.fulfill({ json: responses[url.pathname] });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => failures.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${output}/${name}-${THEME}.png`, animations: 'disabled' });
    console.log('Captured', name);
  };
  await page.goto(origin);
  await page.getByText('Iberdrola', { exact: true }).first().waitFor();
  await capture('watchlist');
  await page.getByRole('button', { name: /^Cartera/ }).first().click();
  await page.waitForTimeout(2500);
  await capture('portfolio');
  await page.getByText(/^En cartera/).first().click();
  await capture('positions');
  await page.getByText('Registro', { exact: true }).first().click();
  await capture('operations');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) failures.push('Desbordamiento horizontal');
  if (failures.length) throw new Error(failures.join(' ; '));
} finally {
  await browser.close();
}
