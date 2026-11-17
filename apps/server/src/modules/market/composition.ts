import type { FundComposition, FundHolding } from '@watchlist/shared';
import { isIsin } from './isin.ts';

/*
 * Composición de fondos y ETF: qué empresas llevan dentro y con qué peso. Ninguna fuente gratuita da la lista
 * completa, así que se guardan las mayores posiciones (las 10 primeras) que publica cada una. Se prueban en orden
 * y vale la primera que responde con datos coherentes:
 *   extraETF (ETF por ISIN, la más al día) → onvista (ETF y fondos por ISIN) → FT Markets (fondos y ETF, incluidos
 *   los españoles) → Yahoo (por su ticker, para lo que no tiene ISIN).
 */
export interface CompositionRef {
  isin: string | null;
  /** Símbolo con el que se sigue el valor (ticker de Yahoo, «FT:…», «XETRA:…»). */
  symbol: string | null;
}
export type SourceComposition = Pick<FundComposition, 'holdings' | 'asOf'>;
export interface CompositionSource {
  readonly id: string;
  getComposition(ref: CompositionRef): Promise<SourceComposition | null>;
}

const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const MAX_HOLDINGS = 25;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isinOrNull = (v: unknown) => (typeof v === 'string' && isIsin(v) ? v.trim().toUpperCase() : null);

/** ISIN que va dentro de un símbolo («XETRA:IE00B4L5Y983», «FT:IE00B03HCZ61:EUR» o el ISIN solo). */
export const isinInSymbol = (symbol: string | null | undefined) =>
  symbol?.toUpperCase().split(':').find((part) => isIsin(part)) ?? null;

/** Descarta pesos imposibles y repetidos; null si lo que queda no parece una composición (suma más del 100 %). */
export function cleanHoldings(raw: FundHolding[], asOf: string | null = null): SourceComposition | null {
  const seen = new Set<string>();
  const holdings: FundHolding[] = [];
  for (const h of raw) {
    const key = h.isin ?? h.name.toLowerCase();
    if (!h.name || !Number.isFinite(h.weight) || h.weight <= 0 || h.weight > 1 || seen.has(key)) continue;
    seen.add(key);
    holdings.push({ ...h, weight: Math.round(h.weight * 1e6) / 1e6 });
  }
  holdings.sort((a, b) => b.weight - a.weight);
  const top = holdings.slice(0, MAX_HOLDINGS);
  if (!top.length || top.reduce((s, h) => s + h.weight, 0) > 1.02) return null;
  return { holdings: top, asOf: asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null };
}

async function get(fetcher: typeof fetch, url: string, accept: string, source: string): Promise<Response | null> {
  const res = await fetcher(url, { headers: { Accept: accept, ...BROWSER }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${source} HTTP ${res.status}`);
  return res;
}

// ── extraETF ────────────────────────────────────────────────────────────────
export function parseExtraEtf(data: unknown): SourceComposition | null {
  if (!Array.isArray(data)) return null;
  return cleanHoldings(data.flatMap((row: Record<string, unknown>) => {
    const name = str(row?.name) ?? str(row?.name_short);
    return name && typeof row.weight === 'number' ? [{ name, isin: isinOrNull(row.isin), ticker: null, weight: row.weight / 100 }] : [];
  }));
}

export class ExtraEtfComposition implements CompositionSource {
  readonly id = 'extraETF';
  constructor(private fetcher: typeof fetch = fetch) {}
  async getComposition({ isin }: CompositionRef) {
    if (!isin) return null;
    const res = await get(this.fetcher, `https://extraetf.com/api-v2/detail/holdings/?isin=${isin}`, 'application/json', this.id);
    return res ? parseExtraEtf(await res.json()) : null;
  }
}

// ── onvista ─────────────────────────────────────────────────────────────────
export function parseOnvistaHoldings(data: unknown): SourceComposition | null {
  const block = (data as { fundsHoldingList?: { dateMaintenance?: unknown; list?: unknown } } | null)?.fundsHoldingList;
  if (!block || !Array.isArray(block.list)) return null;
  const holdings = block.list.flatMap((row: { instrument?: Record<string, unknown>; investmentPct?: unknown }) => {
    const name = str(row?.instrument?.name);
    return name && typeof row.investmentPct === 'number'
      ? [{ name, isin: isinOrNull(row.instrument?.isin), ticker: null, weight: row.investmentPct / 100 }]
      : [];
  });
  return cleanHoldings(holdings, str(block.dateMaintenance)?.slice(0, 10) ?? null);
}

export class OnvistaComposition implements CompositionSource {
  readonly id = 'onvista';
  constructor(private fetcher: typeof fetch = fetch) {}
  async getComposition({ isin }: CompositionRef) {
    if (!isin) return null;
    const res = await get(this.fetcher, `https://api.onvista.de/api/v1/funds/ISIN:${isin}/snapshot`, 'application/json', this.id);
    return res ? parseOnvistaHoldings(await res.json()) : null;
  }
}

// ── FT Markets ──────────────────────────────────────────────────────────────
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
/** Quita las etiquetas hasta que no quede ninguna: una sola pasada deja «<script>» al limpiar «<scr<b>ipt>». */
function stripTags(html: string): string {
  let text = html;
  for (let prev = ''; prev !== text; ) {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  return text.replace(/[<>]/g, '');
}
const decode = (html: string) =>
  stripTags(html)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .trim();

/** Tabla «Top 10 holdings» de la ficha de FT: empresa, su símbolo de FT y el peso. */
export function parseFtHoldings(html: string): SourceComposition | null {
  const start = html.search(/Top 10 holdings\s*<\/h2>/);
  if (start < 0) return null;
  const section = html.slice(start, start + 60_000);
  const holdings: FundHolding[] = [];
  for (const row of section.split(/<tr[\s>]/).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    if (cells.length < 3 || !row.includes('mod-ui-table__cell--text')) continue;
    const [nameHtml = '', tickerHtml] = cells[0]!.split(/<br\s*\/?>/);
    const weight = /^(\d+(?:\.\d+)?)%$/.exec(decode(cells[2]!));
    const name = decode(nameHtml);
    if (!name || !weight) continue;
    holdings.push({ name, isin: null, ticker: (tickerHtml && decode(tickerHtml)) || null, weight: Number(weight[1]) / 100 });
  }
  const date = /As of ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/.exec(section) ?? /As of ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/.exec(html);
  const month = date ? MONTHS.indexOf(date[1]!.toLowerCase()) + 1 : 0;
  const asOf = date && month ? `${date[3]}-${String(month).padStart(2, '0')}-${date[2]!.padStart(2, '0')}` : null;
  return cleanHoldings(holdings, asOf);
}

export class FtComposition implements CompositionSource {
  readonly id = 'FT Markets';
  constructor(private fetcher: typeof fetch = fetch) {}

  private async page(kind: 'funds' | 'etfs', ftSymbol: string) {
    const res = await get(this.fetcher, `https://markets.ft.com/data/${kind}/tearsheet/holdings?s=${encodeURIComponent(ftSymbol)}`, 'text/html', this.id);
    return res ? parseFtHoldings(await res.text()) : null;
  }

  /** Los ETF se piden con su símbolo de bolsa (SWDA:LSE:GBX), que da el buscador de FT a partir del ISIN. */
  private async etfSymbol(isin: string): Promise<string | null> {
    const res = await get(this.fetcher, `https://markets.ft.com/data/searchapi/searchsecurities?query=${isin}`, 'application/json', this.id);
    const data = res ? ((await res.json()) as { data?: { security?: { symbol?: unknown; assetClass?: unknown }[] } }) : null;
    const list = Array.isArray(data?.data?.security) ? data.data.security : [];
    return str(list.find((s) => s?.assetClass === 'ETFs')?.symbol);
  }

  async getComposition({ isin, symbol }: CompositionRef) {
    const own = symbol && /^FT:/i.test(symbol) ? symbol.slice(3).toUpperCase() : null;
    const ownIsin = own ? isIsin(own.split(':')[0]!) : false;
    if (own && !ownIsin) {
      const direct = (await this.page('etfs', own)) ?? (await this.page('funds', own));
      if (direct || !isin) return direct;
    }
    if (!isin) return own ? this.page('funds', own) : null;
    const currency = (ownIsin && own!.split(':')[1]) || 'EUR';
    const fund = await this.page('funds', `${isin}:${currency}`);
    if (fund) return fund;
    const etf = await this.etfSymbol(isin);
    return etf ? this.page('etfs', etf) : null;
  }
}

// ── Yahoo ───────────────────────────────────────────────────────────────────
export function parseYahooHoldings(data: unknown): SourceComposition | null {
  const list = (data as { holdings?: unknown } | null)?.holdings;
  if (!Array.isArray(list)) return null;
  return cleanHoldings(list.flatMap((row: Record<string, unknown>) => {
    const name = str(row?.holdingName);
    return name && typeof row.holdingPercent === 'number' ? [{ name, isin: null, ticker: str(row.symbol), weight: row.holdingPercent }] : [];
  }));
}

/** `topHoldings` es el módulo de quoteSummary de Yahoo; se inyecta para no crear otro cliente. */
export class YahooComposition implements CompositionSource {
  readonly id = 'Yahoo Finance';
  constructor(private topHoldings: (symbol: string) => Promise<unknown>) {}
  async getComposition({ symbol }: CompositionRef) {
    if (!symbol || symbol.includes(':') || isIsin(symbol)) return null;
    return parseYahooHoldings(await this.topHoldings(symbol));
  }
}
