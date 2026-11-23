// Capturas del README a partir del modo demo de la propia aplicación (`/demo`).
// La demo responde en el navegador con datos ficticios, así que no hacen falta backend, base de datos ni cuenta.
// Uso, con `npm run dev -- --host 127.0.0.1` en frontend/ y desde la raíz:
//      node docs/screenshots/capture.mjs [origen] [light|dark]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ?? new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const output = fileURLToPath(new URL('./', import.meta.url));
// Tema de la captura: «light» (por defecto) o «dark». La app sigue el del sistema.
const THEME = process.argv[3] === 'dark' ? 'dark' : 'light';
// Los logos de las empresas los resuelve la API; es lo único que se pide fuera (a la aplicación publicada).
const LOGOS = process.env.LOGOS_ORIGIN ?? 'https://cartera.raclos.es';
// Fecha fija: las operaciones de la demo se fechan respecto a «hoy».
const NOW = new Date('2026-11-20T11:00:00+01:00');

/** Pestañas de la cartera que se capturan, con el nombre del archivo. */
const CARTERA_TABS = [
  ['En cartera', 'positions'],
  ['Exposición', 'exposure'],
  ['Registro', 'operations'],
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--lang=es-ES'] }); // fechas de los selectores en español
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: THEME,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  // Sin los recorridos guiados de la primera visita.
  await context.addInitScript(() => {
    localStorage.setItem('watchlist.tourSeen', '1');
    localStorage.setItem('watchlist.cartera.tourSeen', '1');
  });
  // Solo se sirve la propia web: sin conexiones externas y sin API, la demo usa sus precios ficticios
  // y las capturas salen iguales en cada ejecución. La excepción son los logos.
  const logos = new Map();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/public/logo/')) {
      if (!logos.has(url.pathname)) {
        logos.set(url.pathname, context.request.get(LOGOS + url.pathname).then(
          async (res) => (res.ok() ? { body: await res.body(), contentType: res.headers()['content-type'] } : null),
          () => null,
        ));
      }
      const logo = await logos.get(url.pathname);
      return logo ? route.fulfill(logo) : route.fulfill({ status: 404 }); // sin logo: iniciales
    }
    if (url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.clock.setFixedTime(NOW);

  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => !document.querySelector('[class*="skeleton"]')
      && [...document.images].every((img) => img.complete));
    await page.waitForTimeout(1200); // los gráficos se dibujan tras el primer render
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) failures.push(`Desbordamiento horizontal en ${name}`);
    await page.screenshot({ path: `${output}/${name}-${THEME}.png`, animations: 'disabled' });
    console.log('Capturada', `${name}-${THEME}.png`);
  };

  await page.goto(`${origin}/demo`);
  await page.getByText('Iberdrola', { exact: true }).first().waitFor();
  await capture('watchlist');

  await page.getByRole('button', { name: /^Cartera/ }).first().click();
  await page.getByRole('tablist', { name: 'Secciones de la cartera' }).waitFor();
  await capture('portfolio');

  for (const [tab, name] of CARTERA_TABS) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await capture(name);
  }

  if (failures.length) throw new Error(failures.join(' ; '));
} finally {
  await browser.close();
}
