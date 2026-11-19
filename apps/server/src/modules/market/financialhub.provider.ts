import type { Candle, DailyHistory, HistoryRange, IntradayInterval, PricePoint, Quote, SymbolSearchResult } from '@watchlist/shared';
import { isinInSymbol, tickerOf } from './composition.ts';
import { isIsin } from './isin.ts';
import type { MarketDataProvider } from './provider.ts';

/*
 * Precios de la API pública de Financial Hub (api.financial-hub.es, sin clave): acciones y ETF en directo por su
 * cotización en cada bolsa y fondos por su valor liquidativo. No tiene símbolos propios: traduce los de la app
 * (Yahoo «CHIP.PA», FT «FT:SEC0:GER:EUR», ISIN de fondos) a sus identificadores y, si no hay uno solo seguro, no
 * contesta y el precio sale de la siguiente fuente.
 */
const API = 'https://api.financial-hub.es';
/** Historia que se pide de cada intervalo intradía: unas 2.000-5.000 velas. */
const INTRADAY_RANGE: Record<IntradayInterval, string> = { '1m': '1w', '5m': '1m', '15m': '3m', '30m': '6m', '1h': '1y', '4h': '5y' };
const SOURCE = 'Financial Hub';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'watchlist (uso personal)' };
const DAY = 86_400_000;
const REF_TTL = 7 * DAY;
const NO_REF_TTL = DAY;
const RANGE_TTL = 12 * 3_600_000;
const BATCH = 100;

/**
 * Bolsas (MIC) de cada sufijo de Yahoo y mercado de FT. Londres queda fuera a propósito: allí se cotiza en peniques
 * y la API no dice en qué unidad viene el precio.
 */
const MIC: Record<string, string[]> = {
  DE: ['XETR'], GER: ['XETR'], AS: ['XAMS'], AEX: ['XAMS'], MI: ['XMIL'], MIL: ['XMIL'], PA: ['XPAR'], PAR: ['XPAR'],
  SW: ['XSWX'], SWX: ['XSWX'], MC: ['XMAD'], MCE: ['XMAD'], BR: ['XBRU'], BRU: ['XBRU'], LS: ['XLIS'], LIS: ['XLIS'],
  VI: ['XWBO'], VIE: ['XWBO'], CO: ['XCSE'], ST: ['XSTO'], HE: ['XHEL'], OL: ['XOSL'], TO: ['XTSE'], TOR: ['XTSE'],
  NYQ: ['XNYS'], NSQ: ['XNAS'], NMQ: ['XNAS'], PCQ: ['ARCX'],
};
/** Sin sufijo, Yahoo se refiere a las bolsas de EE. UU. */
const US = ['XNAS', 'XNYS', 'ARCX', 'BATS', 'XASE'];
/** Prefijos con ISIN de otras fuentes (XETRA:IE00B4L5Y983). */
const PREFIX_MIC: Record<string, string[]> = { XETRA: ['XETR'] };
const VENUES: Record<string, string> = {
  XETR: 'Xetra', XAMS: 'Ámsterdam', XMIL: 'Milán', XPAR: 'París', XSWX: 'Suiza', XMAD: 'Madrid', XBRU: 'Bruselas',
  XLIS: 'Lisboa', XWBO: 'Viena', XCSE: 'Copenhague', XSTO: 'Estocolmo', XHEL: 'Helsinki', XOSL: 'Oslo', XTSE: 'Toronto',
  XNAS: 'Nasdaq', XNYS: 'NYSE', ARCX: 'NYSE Arca', BATS: 'Cboe', XASE: 'NYSE American',
};
const TYPES: Record<string, string> = { stock: 'EQUITY', etf: 'ETF', fund: 'MUTUALFUND' };
const PHASES: Record<string, string> = { regular: 'REGULAR', pre: 'PRE', post: 'POST', closed: 'CLOSED' };

/** A qué serie de Financial Hub corresponde un símbolo de la app. */
export interface FhRef {
  kind: 'listing' | 'fund_class';
  id: number;
  currency: string;
  name: string | null;
  isin: string | null;
  quoteType: string | null;
  exchange: string | null;
}

interface Hit {
  type?: string;
  id?: unknown;
  name?: string;
  primary?: Child | null;
  matchedChild?: Child | null;
}
interface Child {
  instrumentId?: unknown;
  listingId?: unknown;
  name?: unknown;
  symbol?: unknown;
  isin?: unknown;
  currency?: unknown;
  exchange?: unknown;
  mic?: unknown;
}
export interface FhQuote {
  price?: unknown;
  previousClose?: unknown;
  changePct?: unknown;
  currency?: unknown;
  asOf?: unknown;
  tradingDate?: unknown;
  marketPhase?: unknown;
  day?: { open?: unknown; high?: unknown; low?: unknown } | null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const id = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const currencyOk = (c: string | null): c is string => !!c && /^[A-Z]{3}$/.test(c);

/** Qué buscar para un símbolo: ISIN de fondo, ISIN en una bolsa o ticker en unas bolsas (con divisa si la dice). */
export type Wanted =
  | { by: 'fund'; isin: string; currency: string | null }
  | { by: 'isin'; isin: string; mics: string[] }
  | { by: 'ticker'; root: string; mics: string[]; currency: string | null };

export function wantedFor(symbol: string): Wanted | null {
  const s = symbol.trim().toUpperCase();
  if (isIsin(s)) return { by: 'fund', isin: s, currency: null };
  const isin = isinInSymbol(s);
  if (isin) {
    if (s.startsWith('FT:')) return { by: 'fund', isin, currency: s.split(':')[2] ?? null };
    const mics = PREFIX_MIC[s.split(':')[0]!];
    return mics ? { by: 'isin', isin, mics } : null;
  }
  if (s.includes(':') && !s.startsWith('FT:')) return null;
  const t = tickerOf(s);
  if (!t) return null;
  const market = s.startsWith('FT:') ? s.split(':')[2] : /\.([A-Z]+)$/.exec(s)?.[1];
  const mics = market ? MIC[market] : US;
  return mics ? { by: 'ticker', root: t.root, mics, currency: t.currency } : null;
}

/** Vela de la sesión en curso a partir de la cotización en directo, o null si no trae los datos del día. */
export function liveCandle(q: FhQuote, currency: string | null): Candle | null {
  const c = num(q.price);
  const t = str(q.tradingDate);
  const o = num(q.day?.open);
  if (c == null || c <= 0 || o == null || o <= 0 || !t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  if (str(q.currency) && str(q.currency) !== currency) return null;
  return { t, o, h: Math.max(num(q.day?.high) ?? c, o, c), l: Math.min(num(q.day?.low) ?? c, o, c), c };
}

export class FinancialHubProvider implements MarketDataProvider {
  readonly id = 'financialhub';
  private refs = new Map<string, { ref: FhRef | null; at: number }>();
  private ranges = new Map<string, { low: number | null; high: number | null; at: number }>();
  constructor(private fetcher: typeof fetch = fetch) {}

  private async json(path: string): Promise<unknown> {
    const res = await this.fetcher(`${API}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${SOURCE} HTTP ${res.status}`);
    return res.json();
  }

  private async lookup(q: string, types?: string): Promise<Hit[]> {
    const found = (await this.json(`/search?q=${encodeURIComponent(q)}&identifierLookup=true${types ? `&types=${types}` : ''}`)) as { data?: Hit[] } | null;
    return Array.isArray(found?.data) ? found.data : [];
  }

  private async listings(instrumentId: number): Promise<Child[]> {
    const found = (await this.json(`/assets/${instrumentId}/listings`)) as { data?: Child[] } | null;
    return Array.isArray(found?.data) ? found.data : [];
  }

  /** La serie de Financial Hub de un símbolo, o null si no hay una sola que encaje sin dudas. */
  async resolve(symbol: string): Promise<FhRef | null> {
    const key = symbol.trim().toUpperCase();
    const cached = this.refs.get(key);
    if (cached && Date.now() - cached.at < (cached.ref ? REF_TTL : NO_REF_TTL)) return cached.ref;
    const want = wantedFor(key);
    const ref = want ? await this.find(want) : null;
    this.refs.set(key, { ref, at: Date.now() });
    return ref;
  }

  private async find(want: Wanted): Promise<FhRef | null> {
    if (want.by === 'fund') {
      const hits = await this.lookup(want.isin, 'fund');
      const found = hits.flatMap((h) =>
        [h.matchedChild, h.primary].filter((c): c is Child => !!c && str(c.isin) === want.isin).map((c) => ({ h, c })),
      );
      const match = found[0];
      const classId = id(match?.c.instrumentId);
      const currency = str(match?.c.currency);
      if (!match || !classId || !currencyOk(currency) || (want.currency && want.currency !== currency)) return null;
      return { kind: 'fund_class', id: classId, currency, name: str(match.c.name) ?? str(match.h.name), isin: want.isin, quoteType: 'MUTUALFUND', exchange: SOURCE };
    }

    const hits = (await this.lookup(want.by === 'isin' ? want.isin : want.root)).filter((h) => h.type === 'stock' || h.type === 'etf');
    const candidates = new Map<number, FhRef>();
    const consider = (h: Hit, c: Child | null | undefined) => {
      const listingId = id(c?.listingId);
      const mic = str(c?.mic) ?? str(c?.exchange);
      const currency = str(c?.currency);
      if (!c || !listingId || !mic || !want.mics.includes(mic) || !currencyOk(currency)) return;
      if (want.by === 'ticker' && (str(c.symbol)?.toUpperCase() !== want.root || (want.currency && want.currency !== currency))) return;
      candidates.set(listingId, {
        kind: 'listing', id: listingId, currency, name: str(c.name) ?? str(h.name), isin: str(c.isin), quoteType: TYPES[h.type!] ?? null, exchange: VENUES[mic] ?? mic,
      });
    };
    for (const h of hits) {
      const sameProduct = want.by === 'isin'
        ? [h.primary, h.matchedChild].some((c) => str(c?.isin) === want.isin)
        : [h.primary, h.matchedChild].some((c) => str(c?.symbol)?.toUpperCase() === want.root);
      if (!sameProduct) continue;
      consider(h, h.matchedChild);
      consider(h, h.primary);
    }
    // Si la búsqueda devuelve el producto pero en otra bolsa, se miran todas sus cotizaciones.
    if (!candidates.size) {
      for (const h of hits.slice(0, 3)) {
        const c = h.matchedChild ?? h.primary;
        const instrumentId = id(c?.instrumentId);
        const isSame = want.by === 'isin' ? str(c?.isin) === want.isin : str(c?.symbol)?.toUpperCase() === want.root || h.type === 'etf';
        if (!instrumentId || !isSame) continue;
        for (const l of await this.listings(instrumentId)) consider(h, { ...l, name: c?.name, isin: c?.isin, instrumentId });
      }
    }
    return candidates.size === 1 ? [...candidates.values()][0]! : null;
  }

  private toQuote(symbol: string, ref: FhRef, q: FhQuote, range: { low: number | null; high: number | null } | undefined): Omit<Quote, 'stale'> | null {
    const price = num(q.price);
    const currency = str(q.currency) ?? ref.currency;
    if (price == null || price <= 0 || !currencyOk(currency) || currency !== ref.currency) return null;
    const fund = ref.kind === 'fund_class';
    const asOf = str(q.tradingDate) ?? str(q.asOf)?.slice(0, 10) ?? undefined;
    return {
      symbol,
      name: ref.name,
      currency,
      price,
      changePct: num(q.changePct) != null ? num(q.changePct)! / 100 : null,
      previousClose: num(q.previousClose),
      low52: range?.low != null ? Math.min(range.low, price) : null,
      high52: range?.high != null ? Math.max(range.high, price) : null,
      quoteType: ref.quoteType,
      exchange: ref.exchange,
      marketState: PHASES[str(q.marketPhase) ?? ''] ?? null,
      fetchedAt: new Date().toISOString(),
      source: SOURCE,
      sourceUrl: ref.isin ? `https://financial-hub.es/${fund ? 'fund' : ref.quoteType === 'ETF' ? 'etf' : 'stock'}/${ref.isin}${fund ? '' : `?listingId=${ref.id}`}` : undefined,
      ...(fund && asOf ? { asOf } : {}),
      ...(ref.isin ? { isin: ref.isin } : {}),
    };
  }

  /** Máximo y mínimo del último año (para el rango de 52 semanas), con caché de 12 h; sin datos si falla. */
  private async yearRange(ref: FhRef) {
    const key = `${ref.kind}:${ref.id}`;
    const cached = this.ranges.get(key);
    if (cached && Date.now() - cached.at < RANGE_TTL) return cached;
    const points = await this.series(ref, 'range=1y').catch(() => null);
    if (!points) return undefined;
    const closes = points.map((p) => p.c);
    const range = { low: closes.length ? Math.min(...closes) : null, high: closes.length ? Math.max(...closes) : null, at: Date.now() };
    this.ranges.set(key, range);
    return range;
  }

  /**
   * Velas de la serie, siguiendo las páginas (los fondos solo tienen valor liquidativo: vela plana). Las diarias
   * llevan la fecha de la sesión; las intradía, la fecha y hora UTC de su inicio (YYYY-MM-DDTHH:MMZ).
   */
  private async ohlc(ref: FhRef, query: string, resolution: '1d' | IntradayInterval = '1d'): Promise<Candle[]> {
    const candles: Candle[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const body = (await this.json(
        `/market/series/${ref.id}/history?kind=${ref.kind}&resolution=${resolution}&pageSize=5000&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      )) as { data?: { points?: Record<string, unknown>[]; nextCursor?: unknown; currency?: unknown } } | null;
      const data = body?.data;
      if (!data) break;
      if (str(data.currency) && str(data.currency) !== ref.currency) return [];
      for (const p of data.points ?? []) {
        const time = str(p.time);
        const t = resolution === '1d' ? time?.slice(0, 10) : time && `${time.slice(0, 16)}Z`;
        const c = num(p.close) ?? num(p.value);
        if (!t || !(resolution === '1d' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/).test(t) || c == null || c <= 0) continue;
        const o = num(p.open) ?? c;
        candles.push({ t, o, h: Math.max(num(p.high) ?? c, o, c), l: Math.min(num(p.low) ?? c, o, c), c });
      }
      cursor = str(data.nextCursor);
      if (!cursor) break;
    }
    return candles.sort((a, b) => a.t.localeCompare(b.t));
  }

  /** Cierres diarios (o valor liquidativo) de la serie. */
  private async series(ref: FhRef, query: string): Promise<PricePoint[]> {
    return (await this.ohlc(ref, query)).map(({ t, c }) => ({ t, c }));
  }

  async getQuotes(symbols: string[]): Promise<Omit<Quote, 'stale'>[]> {
    const refs: { symbol: string; ref: FhRef }[] = [];
    // De cuatro en cuatro para no pasarse del límite de la API; un 429 corta y el resto va a las otras fuentes.
    let limited: unknown = null;
    for (let i = 0; i < symbols.length && !limited; i += 4) {
      const batch = await Promise.all(
        symbols.slice(i, i + 4).map((symbol) => this.resolve(symbol).then((ref) => ({ symbol, ref }), (error) => ((limited ??= error), { symbol, ref: null }))),
      );
      for (const r of batch) if (r.ref) refs.push({ symbol: r.symbol, ref: r.ref });
    }
    if (!refs.length && limited) throw limited;

    const quotes = new Map<string, FhQuote>();
    for (const kind of ['listing', 'fund_class'] as const) {
      const ids = [...new Set(refs.filter((r) => r.ref.kind === kind).map((r) => r.ref.id))];
      for (let i = 0; i < ids.length; i += BATCH) {
        const param = kind === 'listing' ? 'listingIds' : 'instrumentIds';
        const body = (await this.json(`/market/quotes?${param}=${ids.slice(i, i + BATCH).join(',')}`)) as {
          data?: { ref?: { listingId?: unknown; instrumentId?: unknown }; quote?: FhQuote | null }[];
        } | null;
        for (const row of body?.data ?? []) {
          const key = id(kind === 'listing' ? row.ref?.listingId : row.ref?.instrumentId);
          if (key && row.quote) quotes.set(`${kind}:${key}`, row.quote);
        }
      }
    }
    const out: Omit<Quote, 'stale'>[] = [];
    for (const { symbol, ref } of refs) {
      const q = quotes.get(`${ref.kind}:${ref.id}`);
      if (!q) continue;
      const quote = this.toQuote(symbol.trim().toUpperCase(), ref, q, await this.yearRange(ref));
      if (quote) out.push(quote);
    }
    return out;
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<PricePoint[]> {
    const ref = await this.resolve(symbol);
    return ref ? this.series(ref, `range=${range}`) : [];
  }

  /**
   * Solo el valor liquidativo de los fondos: las cotizaciones de bolsa pueden venir ajustadas por splits y el
   * histórico de la cartera necesita los precios tal cual; esas siguen saliendo de las demás fuentes.
   */
  async getDailyHistory(symbol: string, from: string): Promise<DailyHistory> {
    const ref = await this.resolve(symbol);
    if (ref?.kind !== 'fund_class') return { currency: null, points: [] };
    return { currency: ref.currency, points: (await this.series(ref, `from=${from}`)).filter((p) => p.t >= from) };
  }

  /**
   * Velas diarias desde una fecha. El histórico llega hasta la última sesión cerrada; la de hoy se completa con
   * la cotización en directo (apertura, máximo y mínimo del día y último precio).
   */
  async getCandles(symbol: string, from: string): Promise<Candle[]> {
    const ref = await this.resolve(symbol);
    if (!ref) return [];
    const candles = (await this.ohlc(ref, `from=${from}`)).filter((c) => c.t >= from);
    if (ref.kind !== 'listing') return candles;
    const body = (await this.json(`/market/quotes?listingIds=${ref.id}`).catch(() => null)) as { data?: { quote?: FhQuote | null }[] } | null;
    const q = body?.data?.[0]?.quote;
    const live = q ? liveCandle(q, ref.currency) : null;
    const last = candles.at(-1);
    if (live && (!last || live.t > last.t)) candles.push(live);
    else if (live && last && live.t === last.t) candles[candles.length - 1] = live;
    return candles;
  }

  /** Velas intradía de una cotización en bolsa (los fondos no tienen), con más o menos historia según el intervalo. */
  async getIntradayCandles(symbol: string, interval: IntradayInterval): Promise<Candle[]> {
    const ref = await this.resolve(symbol);
    if (ref?.kind !== 'listing') return [];
    return this.ohlc(ref, `range=${INTRADAY_RANGE[interval]}`, interval);
  }

  async getTargets() {
    return null;
  }

  async search(): Promise<SymbolSearchResult[]> {
    return [];
  }
}
