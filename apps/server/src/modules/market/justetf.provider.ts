import type { DailyHistory, HistoryRange, PricePoint, Quote } from '@watchlist/shared';
import { parseOnvistaSymbol } from './onvista.provider.ts';
import type { MarketDataProvider } from './provider.ts';

/*
 * Cotización e histórico de justetf.com (la API JSON de su web) por ISIN, siempre en euros y con el precio de Xetra.
 * Es la reserva de onvista para los símbolos que son un ISIN solo o «XETRA:ISIN», y además les da el histórico que
 * onvista no deja descargar. Las demás bolsas alemanas (Tradegate, gettex…) no son suyas: su precio es otro.
 */
const API = 'https://www.justetf.com/api/etfs';
const SOURCE = 'justETF';
const QUOTE_TTL = 60_000;
const DAY = 86_400_000;
const RANGE_DAYS: Record<HistoryRange, number> = { '1m': 31, '3m': 92, '6m': 183, '1y': 366, '5y': 5 * 366 };

interface Raw { raw?: unknown }
interface JustEtfQuote {
  latestQuote?: Raw;
  latestQuoteDate?: unknown;
  previousQuote?: Raw;
  quoteTradingVenue?: unknown;
  quoteLowHigh?: { low?: Raw; high?: Raw };
}
interface JustEtfChart { series?: { date?: unknown; value?: Raw }[] }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** ISIN de un símbolo que justETF puede cotizar (el ISIN solo o en Xetra), o null. */
export function justEtfIsin(symbol: string): string | null {
  const parsed = parseOnvistaSymbol(symbol);
  return parsed && (!parsed.venue || parsed.venue === 'XETRA') ? parsed.isin : null;
}

export function toQuote(data: JustEtfQuote, symbol: string): Omit<Quote, 'stale'> | null {
  const isin = justEtfIsin(symbol);
  const price = num(data?.latestQuote?.raw);
  if (!isin || !price) return null;
  const previousClose = num(data.previousQuote?.raw);
  const low = num(data.quoteLowHigh?.low?.raw);
  const high = num(data.quoteLowHigh?.high?.raw);
  const range = low && high && low <= price && price <= high;
  const venue = typeof data.quoteTradingVenue === 'string' && data.quoteTradingVenue ? data.quoteTradingVenue : null;
  return {
    symbol,
    name: null,
    currency: 'EUR',
    price,
    previousClose,
    changePct: previousClose ? price / previousClose - 1 : null,
    low52: range ? low : null,
    high52: range ? high : null,
    quoteType: null,
    exchange: venue ? `${venue === 'XETRA' ? 'Xetra' : venue} (justETF)` : SOURCE,
    marketState: null,
    source: SOURCE,
    sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
    asOf: typeof data.latestQuoteDate === 'string' ? data.latestQuoteDate.slice(0, 10) : undefined,
    isin,
    fetchedAt: new Date().toISOString(),
  };
}

/** Cierres de la serie. justETF rellena fines de semana y festivos con el último cierre: se quitan sábados y domingos. */
export function closes(chart: JustEtfChart): PricePoint[] {
  return (chart?.series ?? []).flatMap((p) => {
    const c = num(p?.value?.raw);
    if (!c || typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return [];
    const weekday = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    return weekday === 0 || weekday === 6 ? [] : [{ t: p.date, c }];
  });
}

export class JustEtfProvider implements MarketDataProvider {
  readonly id = 'justetf';
  private quotes = new Map<string, { value: Omit<Quote, 'stale'> | null; expires: number }>();
  constructor(private fetcher: typeof fetch = fetch) {}

  /** null si justETF no conoce el ISIN (404): no es un fallo de la fuente. */
  private async json(path: string): Promise<unknown> {
    const res = await this.fetcher(`${API}/${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`justETF HTTP ${res.status}`);
    return res.json();
  }

  private async quote(symbol: string, isin: string) {
    const hit = this.quotes.get(symbol);
    if (hit && hit.expires > Date.now()) return hit.value;
    const data = (await this.json(`${isin}/quote?locale=en&currency=EUR`)) as JustEtfQuote | null;
    const value = data ? toQuote(data, symbol) : null;
    if (this.quotes.size >= 512) this.quotes.delete(this.quotes.keys().next().value!);
    this.quotes.set(symbol, { value, expires: Date.now() + QUOTE_TTL });
    return value;
  }

  async getQuotes(symbols: string[]) {
    const own = symbols.map((s) => s.toUpperCase()).flatMap((symbol) => {
      const isin = justEtfIsin(symbol);
      return isin ? [{ symbol, isin }] : [];
    });
    const settled = await Promise.allSettled(own.map((o) => this.quote(o.symbol, o.isin)));
    const results = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure && !results.length) throw failure.reason;
    return results;
  }

  private async series(symbol: string, from: string): Promise<PricePoint[]> {
    const isin = justEtfIsin(symbol);
    if (!isin) return [];
    const data = (await this.json(
      `${isin}/performance-chart?locale=en&currency=EUR&valuesType=MARKET_VALUE&reduceData=false&includeDividends=false&features=DIVIDENDS&dateFrom=${from}&dateTo=${day(Date.now())}`,
    )) as JustEtfChart | null;
    return data ? closes(data) : [];
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
    const points = await this.series(symbol, day(Date.now() - RANGE_DAYS[range] * DAY));
    return points.map((p) => ({ t: new Date(p.t).toISOString(), c: p.c }));
  }

  async getDailyHistory(symbol: string, from: string): Promise<DailyHistory> {
    const points = await this.series(symbol, from.slice(0, 10));
    return { currency: points.length ? 'EUR' : null, points: points.filter((p) => p.t >= from) };
  }

  /** No busca: los ISIN ya los resuelven onvista y FT. */
  async search() {
    return [];
  }
  async getTargets() {
    return null;
  }
}
