import { errorSummary } from './provider.ts';

/**
 * Diagnóstico temporal: prueba desde el propio servidor varias formas de pedir la credencial («crumb») de Yahoo,
 * para saber cuál acepta. Solo devuelve códigos de respuesta; nunca la credencial ni las cookies.
 */
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const LIBRARY = 'Mozilla/5.0 (compatible; yahoo-finance2/4.0.6)';
const BROWSER_HEADERS = {
  'User-Agent': CHROME,
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  origin: 'https://finance.yahoo.com',
  referer: 'https://finance.yahoo.com/',
};
const CRUMB1 = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const CRUMB2 = 'https://query2.finance.yahoo.com/v1/test/getcrumb';

export interface ProbeStep {
  name: string;
  status?: number;
  location?: string | null;
  cookies?: string[];
  body?: string;
  error?: string;
}

async function step(name: string, url: string, headers: Record<string, string>): Promise<{ out: ProbeStep; cookie: string }> {
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    const body = await res.text().catch(() => '');
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]!);
    return {
      out: {
        name,
        status: res.status,
        location: res.headers.get('location')?.replace(/\?.*/, '') ?? null,
        cookies: cookies.map((c) => c.split('=')[0]!),
        // Una respuesta 200 de getcrumb es la credencial: solo se cuenta su tamaño.
        body: res.status === 200 ? `(${body.length} caracteres)` : body.replace(/\s+/g, ' ').slice(0, 80),
      },
      cookie: cookies.join('; '),
    };
  } catch (error) {
    return { out: { name, error: errorSummary(error) }, cookie: '' };
  }
}

export async function probeYahoo(): Promise<ProbeStep[]> {
  const out: ProbeStep[] = [];
  const run = async (name: string, url: string, headers: Record<string, string>) => {
    if (out.length) await new Promise((res) => setTimeout(res, 1_000));
    const r = await step(name, url, headers);
    out.push(r.out);
    return r.cookie;
  };
  await run('crumb sin cookie, navegador', CRUMB1, { 'User-Agent': CHROME });
  await run('crumb sin cookie, librería', CRUMB1, { 'User-Agent': LIBRARY });
  await run('crumb sin cookie, cabeceras completas', CRUMB1, BROWSER_HEADERS);
  await run('crumb sin cookie, query2', CRUMB2, { 'User-Agent': CHROME });
  const fc = await run('cookie de fc.yahoo.com', 'https://fc.yahoo.com/', { 'User-Agent': CHROME });
  if (fc) {
    await run('crumb con cookie fc, query1', CRUMB1, { 'User-Agent': CHROME, cookie: fc });
    await run('crumb con cookie fc, query2', CRUMB2, { ...BROWSER_HEADERS, cookie: fc });
  }
  const page = await run('página finance.yahoo.com/quote/AAPL', 'https://finance.yahoo.com/quote/AAPL', { 'User-Agent': CHROME, accept: 'text/html' });
  if (page) await run('crumb con cookie de la página', CRUMB1, { 'User-Agent': CHROME, cookie: page });
  await run('gráfico (control)', 'https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d', { 'User-Agent': CHROME });
  return out;
}
