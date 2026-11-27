// Capturas del README a partir del modo demo de la propia aplicación (`/demo`).
// La demo responde en el navegador, así que no hacen falta backend, base de datos ni cuenta.
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
// Lo único que se pide fuera, a la aplicación publicada: los logos de las empresas y las cotizaciones y velas
// reales que la demo usa en lugar de sus precios inventados (`/api/public/market/demo`).
const PUBLIC = process.env.PUBLIC_ORIGIN ?? process.env.LOGOS_ORIGIN ?? 'https://cartera.raclos.es';
// La demo fecha sus operaciones respecto a «hoy» y las velas reales llegan hasta hoy: se fija la hora del momento
// de la captura (o la de CAPTURE_NOW) para que no cambie a mitad de la ejecución.
const NOW = new Date(process.env.CAPTURE_NOW ?? Date.now());

/** Valor de la lista cuyo detalle (gráfica de velas con niveles e indicadores) se captura. */
const CHART_VALUE = process.env.CHART_VALUE ?? 'BBVA';

/** Indicadores de la gráfica: tendencia (EMA 50 y 200) encima de las velas, volumen y RSI debajo. */
const INDICATORS = [
  { id: 'ema-50', kind: 'ema', params: { n: 50 }, color: '#2962ff' },
  { id: 'ema-200', kind: 'ema', params: { n: 200 }, color: '#e040fb' },
  { id: 'volume-20', kind: 'volume', params: { n: 20 }, color: '#2962ff' },
  { id: 'rsi-14', kind: 'rsi', params: { n: 14 }, color: '#7e57c2' },
];

/** Avisos propios de la demo que no deben salir en las capturas (banda superior y notificaciones). */
const HIDE_CSS = '.demo-banner, .update-banner, .push-banner, [role="status"].toast, .toast { display: none !important; }';

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
  // Sin los recorridos guiados de la primera visita y con los indicadores de la gráfica elegidos.
  await context.addInitScript(({ indicators, css }) => {
    localStorage.setItem('watchlist.tourSeen', '1');
    localStorage.setItem('watchlist.cartera.tourSeen', '1');
    localStorage.setItem('watchlist.velas.indicadores', JSON.stringify(indicators));
    localStorage.setItem('watchlist.velas.volumenAnadido', '1');
    localStorage.setItem('watchlist.velas.periodo', JSON.stringify('1y'));
    localStorage.setItem('watchlist.detalle.vista', 'velas');
    const style = document.createElement('style');
    style.textContent = css;
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  }, { indicators: INDICATORS, css: HIDE_CSS });
  // Solo se sirve la propia web: sin conexiones externas ni API propia. Las excepciones, que se piden a la
  // aplicación publicada, son los logos y las cotizaciones reales de la demo.
  const proxied = new Map();
  const fromPublic = (path) => {
    if (!proxied.has(path)) {
      proxied.set(path, context.request.get(PUBLIC + path, { timeout: 30_000 }).then(
        async (res) => (res.ok() ? { body: await res.body(), contentType: res.headers()['content-type'] } : null),
        () => null,
      ));
    }
    return proxied.get(path);
  };
  const missingLogos = new Set();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const isLogo = url.pathname.startsWith('/api/public/logo/');
    if (isLogo || url.pathname.startsWith('/api/public/market/demo')) {
      const res = await fromPublic(isLogo ? url.pathname : url.pathname + url.search);
      if (!res && isLogo) missingLogos.add(url.pathname);
      return res ? route.fulfill(res) : route.fulfill({ status: 404 });
    }
    if (url.pathname.startsWith('/api/')) return route.abort();
    return route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.clock.setFixedTime(NOW);

  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    // Todos los logos cargados (ninguno con iniciales de reserva) y nada pendiente de cargar.
    await page.waitForFunction(() => !document.querySelector('[class*="skeleton"], .logo--initials')
      && [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    await page.waitForTimeout(1500); // los gráficos se dibujan tras el primer render
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) failures.push(`Desbordamiento horizontal en ${name}`);
    // Nada que delate la demo en lo que sale en pantalla.
    const demoText = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const found = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!/demo|ficticio/i.test(node.textContent)) continue;
        const el = node.parentElement;
        const box = el.getBoundingClientRect();
        if (el.checkVisibility({ visibilityProperty: true }) && box.bottom > 0 && box.top < innerHeight && box.width > 1) found.push(node.textContent.trim());
      }
      return found;
    });
    if (demoText.length) failures.push(`Texto de la demo visible en ${name}: ${demoText.join(' | ')}`);
    await page.screenshot({ path: `${output}/${name}-${THEME}.png`, animations: 'disabled' });
    console.log('Capturada', `${name}-${THEME}.png`);
  };
  const carteraTab = async (tab) => {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
  };

  await page.goto(`${origin}/demo`);
  await page.getByText('Iberdrola', { exact: true }).first().waitFor();
  await capture('watchlist');

  // Detalle de un valor: gráfica de velas con los niveles de compra y los indicadores.
  await page.locator('button.name-btn', { hasText: CHART_VALUE }).click();
  await page.locator('.xp-candles canvas').first().waitFor();
  await page.waitForTimeout(1500); // el desplazamiento hasta el detalle
  // El detalle, justo bajo la cabecera: sin asomar la fila de encima ni la de debajo. Si de la siguiente solo
  // asomarían unos píxeles (su franja de estado, una rayita verde en la esquina), se baja el detalle hasta taparla,
  // mientras la fila de encima siga bajo la cabecera.
  await page.evaluate(() => {
    const main = document.querySelector('.xp__main');
    const row = main.closest('tr').getBoundingClientRect();
    const header = document.querySelector('.topbar').getBoundingClientRect().bottom;
    let scroll = main.getBoundingClientRect().top - header - 12;
    const gap = Math.ceil(innerHeight - (row.bottom - scroll)) + 1;
    const room = header - (row.top - scroll);
    if (gap > 0 && gap <= room) scroll -= gap;
    window.scrollBy(0, scroll);
  });
  await page.mouse.move(0, 0);
  await capture('chart');

  await page.getByRole('button', { name: /^Cartera/ }).first().click();
  await page.getByRole('tablist', { name: 'Secciones de la cartera' }).waitFor();
  await carteraTab('Resumen');
  await capture('portfolio');

  await carteraTab('En cartera');
  await capture('positions');

  await carteraTab('Exposición');
  await capture('exposure');

  await carteraTab('Registro');
  await capture('operations');

  await carteraTab('Renta');
  await capture('renta');

  if (missingLogos.size) failures.push(`Logos sin cargar: ${[...missingLogos].join(', ')}`);
  if (failures.length) throw new Error(failures.join(' ; '));
} finally {
  await browser.close();
}
