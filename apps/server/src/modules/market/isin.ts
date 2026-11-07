/**
 * Búsqueda por ISIN: Yahoo no busca por ISIN, así que se traduce a tickers con OpenFIGI
 * (servicio público y gratuito de Bloomberg) y se pasan a la nomenclatura de Yahoo.
 */
export const isIsin = (q: string) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(q.trim().toUpperCase());

/** Código de bolsa de OpenFIGI → sufijo de Yahoo. */
const SUFFIX: Record<string, string> = {
  SM: '.MC', SQ: '.MC', // España
  NA: '.AS', // Ámsterdam
  FP: '.PA', // París
  GY: '.DE', GR: '.DE', // Xetra / Alemania
  IM: '.MI', // Milán
  LN: '.L', // Londres
  SW: '.SW', SE: '.SW', // Suiza
  BB: '.BR', // Bruselas
  PL: '.LS', // Lisboa
  ID: '.IR', // Dublín
  AV: '.VI', // Viena
  FH: '.HE', // Helsinki
  DC: '.CO', // Copenhague
  SS: '.ST', // Estocolmo
  NO: '.OL', // Oslo
  CN: '.TO', CT: '.TO', // Toronto
  AU: '.AX', AT: '.AX', // Australia
  JP: '.T', JT: '.T', // Tokio
  HK: '.HK', // Hong Kong
  US: '', UN: '', UQ: '', UW: '', UA: '', UR: '', // EE. UU.
};

/** Bolsa preferida según el país del ISIN (la "de casa" del valor). */
const HOME: Record<string, string[]> = {
  ES: ['SM'], NL: ['NA'], FR: ['FP'], DE: ['GY', 'GR'], IT: ['IM'], GB: ['LN'], CH: ['SW', 'SE'], BE: ['BB'],
  PT: ['PL'], IE: ['LN', 'GY', 'NA', 'IM'], LU: ['GY', 'LN', 'NA', 'IM'], AT: ['AV'], FI: ['FH'], DK: ['DC'],
  SE: ['SS'], NO: ['NO'], CA: ['CN'], AU: ['AU'], JP: ['JP'], HK: ['HK'], US: ['US', 'UN', 'UQ', 'UW'],
};

const toYahoo = (ticker: string, exch: string) => `${ticker.replace(/[/ ]/g, '-')}${SUFFIX[exch]}`;

/** Tickers de Yahoo candidatos para un ISIN, en orden de preferencia (máximo 8). */
export async function isinCandidates(isin: string): Promise<string[]> {
  const res = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'watchlist-app' },
    body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin.trim().toUpperCase() }]),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const [result] = (await res.json()) as { data?: { ticker: string; exchCode: string }[] }[];
  const home = HOME[isin.slice(0, 2).toUpperCase()] ?? [];
  const rank = (exch: string) => {
    const i = home.indexOf(exch);
    return i >= 0 ? i : home.length + Object.keys(SUFFIX).indexOf(exch);
  };
  const seen = new Set<string>();
  return (result?.data ?? [])
    .filter((d) => d.exchCode in SUFFIX)
    .sort((a, b) => rank(a.exchCode) - rank(b.exchCode))
    .map((d) => toYahoo(d.ticker, d.exchCode))
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
    .slice(0, 8);
}
