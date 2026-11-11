import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, itemInputSchema } from '../../packages/shared/src/schemas.ts';
import { instrumentInputSchema, operationInputSchema } from '../../packages/shared/src/cartera/schemas.ts';
import { computeMetrics } from '../../packages/shared/src/calc.ts';
import { computePortfolioHistory, shiftDate } from '../../packages/shared/src/cartera/history.ts';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ?? new URL('../../package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const output = fileURLToPath(new URL('./', import.meta.url));
const now = '2026-11-11T11:00:00.000Z';
const settings = { ...DEFAULT_SETTINGS, theme: 'light' };
const examples = [
  ['IBE.MC', 'Iberdrola', 13.48, 13.5, 0.012, 'Energía'],
  ['MSFT', 'Microsoft', 425.6, 410, -0.007, 'Tecnología'],
  ['SAN.MC', 'Santander', 5.24, 5.1, 0.008, 'Finanzas'],
  ['VWCE.DE', 'Vanguard FTSE All-World', 126.3, 120, 0.004, 'ETF global'],
];
const quotes = Object.fromEntries(examples.map(([symbol, name, price, , changePct]) => [symbol, {
  symbol, name, price, changePct, currency: symbol === 'MSFT' ? 'USD' : 'EUR',
  previousClose: price / (1 + changePct), low52: price * 0.74, high52: price * 1.12,
  quoteType: symbol === 'VWCE.DE' ? 'ETF' : 'EQUITY', exchange: 'Demo',
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
const operations = examples.flatMap(([ticker, , price], index) => [
  { ticker, date: '2026-02-12', type: 'buy', shares: [160, 8, 240, 18][index],
    price: price * 0.88, amountEur: [160, 8, 240, 18][index] * price * 0.88 / fx[quotes[ticker].currency], broker: index % 2 ? 'MyInvestor' : 'ING' },
  { ticker, date: '2026-08-15', type: 'dividend', amountEur: [42, 18, 35, 0][index], broker: index % 2 ? 'MyInvestor' : 'ING' },
]).filter((op) => op.amountEur > 0).map((op, index) => ({
  id: index + 1, ...operationInputSchema.parse(op), createdAt: now, updatedAt: now,
}));
const list = { id: 1, name: 'Vigilar nuevas', itemCount: rows.length };
const sparks = Object.fromEntries(examples.map(([symbol, , price], index) => [symbol,
  Array.from({ length: 40 }, (_, i) => +(price * (0.86 + i * 0.0035 + Math.sin(i * 0.7 + index) * 0.02)).toFixed(2)),
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
  const context = await browser.newContext({ viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES',
    timezoneId: 'Europe/Madrid', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('watchlist.tourSeen', '1'));
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
    await expect(page.locator('body')).not.toContainText('Cargando');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
    console.log(`Captured ${name}.png`);
  };
  await page.goto(origin);
  await expect(page.getByText('Iberdrola', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await capture('watchlist-mobile');
  await page.getByRole('button', { name: /^Cartera/ }).click();
  await expect(page.getByText('Valor actual', { exact: true })).toBeVisible();
  await capture('portfolio-mobile');
  await page.getByRole('combobox', { name: 'Sección de Cartera' }).selectOption('registro');
  await expect(page.getByRole('button', { name: /Editar IBE.MC/ }).filter({ visible: true }).first()).toBeVisible();
  await capture('operations-mobile');
  if (failures.length) throw new Error(failures.join('\n'));
} finally {
  await browser.close();
}
