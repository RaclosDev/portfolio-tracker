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
  // Sin sufijo de Yahoo, pero sirven para dar el ticker de casa de una posición de un fondo (TSMC → 2330).
  TW: ['TT'], KR: ['KS'], CN: ['CH', 'C1', 'C2'], IN: ['IN', 'IB'], BR: ['BZ'],
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

/** OpenFIGI sin clave admite 10 ISIN por petición y 25 peticiones por minuto. */
const FIGI_BATCH = 10;

/**
 * Ticker con el que se conoce cada ISIN en su bolsa de casa (US4592001014 → IBM, ES0142090317 → OHLA), sin sufijo de bolsa.
 * null si OpenFIGI no lo conoce. Los que no se han podido preguntar (límite, red) no salen en el resultado.
 */
export async function isinTickers(isins: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < isins.length; i += FIGI_BATCH) {
    const batch = isins.slice(i, i + FIGI_BATCH);
    try {
      const res = await fetch('https://api.openfigi.com/v3/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'watchlist-app' },
        body: JSON.stringify(batch.map((isin) => ({ idType: 'ID_ISIN', idValue: isin }))),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) break; // 429: se deja para la próxima vez
      const results = (await res.json()) as { data?: { ticker?: string; exchCode?: string }[] }[];
      if (!Array.isArray(results)) break;
      batch.forEach((isin, j) => {
        const data = (results[j]?.data ?? []).filter((d) => d.ticker && d.exchCode);
        const home = HOME[isin.slice(0, 2)] ?? [];
        const best =
          home.map((e) => data.find((d) => d.exchCode === e)).find(Boolean) ??
          data.find((d) => d.exchCode! in SUFFIX) ??
          data[0];
        out.set(isin, best?.ticker?.trim() || null);
      });
    } catch {
      break;
    }
  }
  return out;
}
