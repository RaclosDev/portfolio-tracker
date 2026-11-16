import type { DailyHistory, HistoryRange, PricePoint, Quote, SymbolSearchResult } from '@watchlist/shared';
import type { MarketDataProvider } from './provider.ts';

/*
 * Cotizaciones e histórico de markets.ft.com (las API JSON de su web). Busca por nombre, ISIN o símbolo y cubre
 * bolsas que Yahoo no tiene o tiene sin gráfico (p. ej. GZUR en Xetra), además de fondos por ISIN y divisa.
 * Símbolos: «FT:» + el símbolo de FT, p. ej. «FT:GZUR:GER:EUR», «FT:ITX:MCE», «FT:IE00B03HCZ61:EUR».
 */
const ORIGIN = 'https://markets.ft.com/data';
const SOURCE = 'FT Markets';
const QUOTE_TTL = 60_000;
const DAY = 86_400_000;
const FT_SYMBOL = /^FT:([A-Z0-9][A-Z0-9.:-]{0,27})$/;
const TYPES: Readonly<Record<string, string>> = { Equities: 'EQUITY', ETFs: 'ETF', Funds: 'MUTUALFUND' };
/** Códigos de bolsa de FT más habituales; el resto se muestra con su código. */
const VENUES: Readonly<Record<string, string>> = {
  GER: 'Xetra', FRA: 'Fráncfort', STU: 'Stuttgart', DUS: 'Düsseldorf', MUN: 'Múnich', BER: 'Berlín', HAM: 'Hamburgo',
  LSE: 'Londres', MCE: 'Madrid', MIL: 'Milán', PAR: 'París', AEX: 'Ámsterdam', BRU: 'Bruselas', LIS: 'Lisboa',
  SWX: 'Suiza', VIE: 'Viena', NYQ: 'NYSE', NSQ: 'Nasdaq', NMQ: 'Nasdaq', PCQ: 'NYSE Arca', TOR: 'Toronto', TYO: 'Tokio',
};
const RANGE_DAYS: Record<HistoryRange, number> = { '1m': 31, '3m': 92, '6m': 183, '1y': 366, '5y': 5 * 366 };

interface Security { symbol: string; name: string; xid: string; assetClass: string }
interface Series {
  Dates?: string[];
  Elements?: {
    CompanyName?: string;
    ExchangeId?: string;
    Currency?: string;
    ComponentSeries?: { Type: string; Values?: (number | null)[] }[];
  }[];
}

export const parseFtSymbol = (symbol: string) => FT_SYMBOL.exec(symbol.trim().toUpperCase())?.[1] ?? null;
/** Los fondos no cotizan en bolsa: su símbolo es ISIN:divisa. */
const exchange = (code: string | undefined, type: string | null) => (code && type !== 'MUTUALFUND' ? `${VENUES[code] ?? code} (FT)` : SOURCE);

/** Cierres positivos de la serie, con su fecha (AAAA-MM-DD). */
export function closes(series: Series): PricePoint[] {
  const values = series.Elements?.[0]?.ComponentSeries?.find((c) => c.Type === 'Close')?.Values ?? [];
  return (series.Dates ?? []).flatMap((date, i) => {
    const c = values[i];
    return typeof c === 'number' && Number.isFinite(c) && c > 0 && /^\d{4}-\d{2}-\d{2}/.test(date) ? [{ t: date.slice(0, 10), c }] : [];
  });
}

export function toQuote(series: Series, symbol: string, type: string | null = null): Omit<Quote, 'stale'> | null {
  const element = series.Elements?.[0];
  const points = closes(series);
  const last = points.at(-1);
  const currency = element?.Currency;
  if (!element || !last || !currency || !/^[A-Za-z]{3}$/.test(currency)) return null;
  const previousClose = points.at(-2)?.c ?? null;
  const year = points.map((p) => p.c);
  return {
    symbol,
    name: element.CompanyName ?? null,
    currency,
    price: last.c,
    previousClose,
    changePct: previousClose ? last.c / previousClose - 1 : null,
    low52: Math.min(...year),
    high52: Math.max(...year),
    quoteType: type,
    exchange: exchange(element.ExchangeId, type),
    marketState: null,
    source: SOURCE,
    asOf: last.t,
    fetchedAt: new Date().toISOString(),
  };
}

export class FtProvider implements MarketDataProvider {
  readonly id = 'ft';
  /** Identificador interno de FT (xid) y tipo de cada símbolo: los da la búsqueda; el gráfico pide el xid. */
  private xids = new Map<string, { xid: string; type: string | null }>();
  private quotes = new Map<string, { value: Omit<Quote, 'stale'> | null; expires: number }>();
  constructor(private fetcher: typeof fetch = fetch) {}

  private async json(path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetcher(`${ORIGIN}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`FT HTTP ${res.status}`);
    return res.json();
  }

  private async securities(query: string): Promise<Security[]> {
    const data = (await this.json(`/searchapi/searchsecurities?query=${encodeURIComponent(query)}`)) as { data?: { security?: unknown } };
    const list = Array.isArray(data?.data?.security) ? (data.data.security as Security[]) : [];
    const found = list.filter((s) => s && typeof s.symbol === 'string' && typeof s.name === 'string' && typeof s.xid === 'string' && /^\d+$/.test(s.xid));
    for (const s of found) {
      if (this.xids.size >= 2048) this.xids.delete(this.xids.keys().next().value!);
      this.xids.set(s.symbol.toUpperCase(), { xid: s.xid, type: TYPES[s.assetClass] ?? null });
    }
    return found;
  }

  private async known(ftSymbol: string) {
    if (!this.xids.has(ftSymbol)) await this.securities(ftSymbol);
    return this.xids.get(ftSymbol) ?? null;
  }

  private async series(ftSymbol: string, days: number): Promise<Series | null> {
    const xid = (await this.known(ftSymbol))?.xid;
    if (!xid) return null;
    return (await this.json('/chartapi/series', {
      days, dataNormalized: false, dataPeriod: 'Day', dataInterval: 1, realtime: false, yFormat: '0.###',
      returnDateType: 'ISO8601', elements: [{ Type: 'price', Symbol: xid, OverlayIndicators: [], Params: {} }],
    })) as Series;
  }

  private async quote(symbol: string, ftSymbol: string): Promise<Omit<Quote, 'stale'> | null> {
    const hit = this.quotes.get(symbol);
    if (hit && hit.expires > Date.now()) return hit.value;
    const series = await this.series(ftSymbol, 366);
    const value = series && toQuote(series, symbol, this.xids.get(ftSymbol)?.type);
    if (this.quotes.size >= 512) this.quotes.delete(this.quotes.keys().next().value!);
    this.quotes.set(symbol, { value, expires: Date.now() + QUOTE_TTL });
    return value;
  }

  async getQuotes(symbols: string[]) {
    const own = symbols.map((s) => s.toUpperCase()).flatMap((symbol) => {
      const ftSymbol = parseFtSymbol(symbol);
      return ftSymbol ? [{ symbol, ftSymbol }] : [];
    });
    const settled = await Promise.allSettled(own.map((o) => this.quote(o.symbol, o.ftSymbol)));
    const results = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure && !results.length) throw failure.reason;
    return results;
  }

  /** Por nombre, ISIN o símbolo de FT. Los símbolos de otras fuentes (XETRA:…, BORSA:…) no son suyos. */
  async search(query: string): Promise<SymbolSearchResult[]> {
    const q = query.trim();
    const ftSymbol = parseFtSymbol(q);
    if (q.length < 3 || q.length > 100 || (q.includes(':') && !ftSymbol)) return [];
    return (await this.securities(ftSymbol ?? q))
      .filter((s) => TYPES[s.assetClass] && (!ftSymbol || s.symbol.toUpperCase() === ftSymbol))
      .slice(0, 8)
      .map((s) => ({ symbol: `FT:${s.symbol.toUpperCase()}`, name: s.name, exchange: exchange(s.symbol.split(':')[1], TYPES[s.assetClass]!), type: TYPES[s.assetClass]! }));
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
    const ftSymbol = parseFtSymbol(symbol);
    const series = ftSymbol && (await this.series(ftSymbol, RANGE_DAYS[range]));
    return series ? closes(series).map((p) => ({ t: new Date(p.t).toISOString(), c: p.c })) : [];
  }

  // shortcut: FT no publica los splits, así que los cierres anteriores a uno salen ya ajustados; si un valor seguido
  // por FT hace split, habrá que leer sus eventos para deshacer el ajuste como en Yahoo.
  async getDailyHistory(symbol: string, from: string): Promise<DailyHistory> {
    const ftSymbol = parseFtSymbol(symbol);
    const days = Math.ceil((Date.now() - Date.parse(from)) / DAY) + 1;
    const series = ftSymbol && days > 0 ? await this.series(ftSymbol, days) : null;
    if (!series) return { currency: null, points: [] };
    return { currency: series.Elements?.[0]?.Currency ?? null, points: closes(series).filter((p) => p.t >= from) };
  }

  async getTargets() {
    return null;
  }
}
