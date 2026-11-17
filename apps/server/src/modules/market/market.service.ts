import { shiftDate, type FundComposition, type AnalystTargets, type DailyHistory, type HistoryRange, type InstrumentHit, type Listing, type PricePoint, type Quote, type SymbolSearchResult } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';
import { isinCandidates, isIsin } from './isin.ts';
import { queryWords, rankByWords, sameName, wordPairs, wordScore } from './words.ts';
import { isVenueSymbol } from './onvista.provider.ts';
import { parseFtSymbol } from './ft.provider.ts';
import type { CompanyProfile, InstrumentCatalog, MarketDataProvider } from './provider.ts';
import type { CompositionRef, CompositionSource } from './composition.ts';

type Kind = string; // 'quote' | TARGETS_KIND | 'history-<periodo>'
/** Sube la versión cuando AnalystTargets gane campos: así no se sirve la caché antigua sin ellos. */
const TARGETS_KIND = 'targets-v2';
const HISTORY_TTL_MS = 60 * 60_000;
const EMPTY_HISTORY_TTL_MS = 5 * 60_000;
const PROFILE_TTL_MS = 30 * 24 * 60 * 60_000;
/** Las gestoras publican la composición una vez al mes: una semana de caché; un día si ninguna fuente la tenía. */
const COMPOSITION_KIND = 'holdings-v1';
const COMPOSITION_TTL_MS = 7 * 24 * 60 * 60_000;
const NO_COMPOSITION_TTL_MS = 24 * 60 * 60_000;
/** Los minigráficos usan observaciones diarias o mensuales: se renuevan cada 3 h. */
const SPARK_TTL_MS = 3 * 60 * 60_000;
/** Pausa entre históricos renovados en segundo plano, para no ir a ráfagas. */
const REFRESH_GAP_MS = 1_500;
interface Entry<T> {
  value: T;
  fetchedAt: number;
}

/** Divisas que cotizan en centésimas (Londres en peniques, Tel Aviv en agorot…). */
export const MINOR_UNITS: Record<string, { major: string; factor: number }> = {
  GBp: { major: 'GBP', factor: 100 },
  GBX: { major: 'GBP', factor: 100 },
  ILA: { major: 'ILS', factor: 100 },
  ZAc: { major: 'ZAR', factor: 100 },
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Capa de caché sobre el proveedor:
 *  - memoria con TTL para no pedir lo mismo en cada refresco,
 *  - SQLite como último dato conocido (sin conexión → se sirve marcado `stale`).
 */
/** ¿El proveedor nos está limitando? (HTTP 429 "Too Many Requests") */
const isRateLimit = (err: unknown) => /\b429\b|too many requests/i.test(err instanceof Error ? err.message : String(err));
const BACKOFF_START_MS = 60_000;
const BACKOFF_MAX_MS = 15 * 60_000;

export class MarketService {
  private mem = new Map<string, Entry<unknown>>();
  /** Si Yahoo limita las consultas, no se le vuelve a preguntar hasta esta hora (espera creciente). */
  private throttledUntil = 0;
  private backoffMs = BACKOFF_START_MS;

  /** Hora (ISO) hasta la que se pausan las consultas por límite del proveedor, o null. */
  get throttledUntilIso(): string | null {
    return Date.now() < this.throttledUntil ? new Date(this.throttledUntil).toISOString() : null;
  }

  private get throttled() {
    return Date.now() < this.throttledUntil;
  }

  private onProviderError(err: unknown, what: string) {
    if (isRateLimit(err)) {
      this.throttledUntil = Date.now() + this.backoffMs;
      this.log(`Yahoo limita las consultas: se reintenta en ${Math.round(this.backoffMs / 60_000)} min`);
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    } else {
      this.log(what, err);
    }
  }

  constructor(
    private provider: MarketDataProvider,
    private db: Db,
    private opts: { quoteTtlMs: number; targetsTtlMs: number },
    private log: (msg: string, err?: unknown) => void = () => {},
    private catalog?: InstrumentCatalog,
    private compositionSources: CompositionSource[] = [],
  ) {}

  get providerId() {
    return this.provider.id;
  }

  private dailyPending = new Map<string, Promise<DailyHistory & { stale: boolean }>>();

  async getDailyHistory(symbol: string, from: string): Promise<DailyHistory & { stale: boolean }> {
    const start = `${shiftDate(from, -7).slice(0, 4)}-01-01`;
    const key = `${start}:${symbol}`;
    const pending = this.dailyPending.get(key);
    if (pending) return pending;
    const request = this.loadDailyHistory(symbol, start);
    this.dailyPending.set(key, request);
    try { return await request; }
    finally { this.dailyPending.delete(key); }
  }

  private async loadDailyHistory(symbol: string, start: string): Promise<DailyHistory & { stale: boolean }> {
    const kind = `daily-v1-${start}`;
    const key = `${kind}:${symbol}`;
    const cached = (this.mem.get(key) as Entry<DailyHistory> | undefined) ?? await this.load<DailyHistory>(kind, symbol);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) {
      this.mem.set(key, cached);
      return { ...cached.value, stale: false };
    }
    if (!this.throttled && this.provider.getDailyHistory) {
      try {
        const value = await this.provider.getDailyHistory(symbol, start);
        if (!value.points.length && cached?.value.points.length) throw new Error('Sin cierres diarios actualizados');
        this.mem.set(key, { value, fetchedAt: Date.now() });
        await this.persist(kind, symbol, value);
        return { ...value, stale: false };
      } catch (err) { this.onProviderError(err, `Sin histórico diario de ${symbol}`); }
    }
    return { ...(cached?.value ?? { currency: null, points: [] }), stale: true };
  }

  invalidateQuotes() {
    for (const k of this.mem.keys()) if (k.startsWith('quote:')) this.mem.delete(k);
  }

  async getQuotes(symbols: string[], { force = false } = {}): Promise<Map<string, Quote>> {
    const out = new Map<string, Quote>();
    const now = Date.now();
    const missing: string[] = [];
    for (const sym of new Set(symbols)) {
      const hit = this.mem.get(`quote:${sym}`) as Entry<Quote> | undefined;
      if (!force && hit && now - hit.fetchedAt < this.opts.quoteTtlMs) out.set(sym, hit.value);
      else missing.push(sym);
    }
    if (!missing.length) return out;

    let fetched: Omit<Quote, 'stale'>[] = [];
    if (!this.throttled) {
      try {
        fetched = await this.provider.getQuotes(missing);
        this.backoffMs = BACKOFF_START_MS;
      } catch (err) {
        this.onProviderError(err, `No se pudieron obtener cotizaciones (${missing.join(', ')})`);
      }
    }
    const bySymbol = new Map(fetched.map((q) => [q.symbol.toUpperCase(), q]));
    await Promise.all(
      missing.map(async (sym) => {
        const q = bySymbol.get(sym.toUpperCase());
        if (q) {
          const quote: Quote = { ...q, symbol: sym, stale: false };
          this.mem.set(`quote:${sym}`, { value: quote, fetchedAt: now });
          await this.persist('quote', sym, quote);
          out.set(sym, quote);
        } else {
          const stored = await this.load<Quote>('quote', sym);
          if (stored) out.set(sym, { ...stored.value, stale: true });
        }
      }),
    );
    return out;
  }

  async getTargets(symbols: string[], { force = false } = {}): Promise<Map<string, AnalystTargets | null>> {
    const out = new Map<string, AnalystTargets | null>();
    await mapLimit([...new Set(symbols)], 4, async (sym) => {
      const key = `${TARGETS_KIND}:${sym}`;
      const cached =
        (this.mem.get(key) as Entry<AnalystTargets | null> | undefined) ?? (await this.load<AnalystTargets | null>(TARGETS_KIND, sym));
      if ((!force && cached && Date.now() - cached.fetchedAt < this.opts.targetsTtlMs) || this.throttled) {
        if (cached) this.mem.set(key, cached);
        out.set(sym, cached?.value ?? null);
        return;
      }
      try {
        const t = await this.provider.getTargets(sym);
        const value = t ? { ...t, fetchedAt: new Date().toISOString() } : null;
        const entry = { value, fetchedAt: Date.now() };
        this.mem.set(key, entry);
        await this.persist(TARGETS_KIND, sym, value);
        out.set(sym, value);
      } catch (err) {
        this.onProviderError(err, `Sin consenso para ${sym}`);
        out.set(sym, cached?.value ?? null);
      }
    });
    return out;
  }

  /**
   * Tipos de cambio: unidades de cada divisa por 1 de `base`.
   * Para divisas en centésimas (GBp) aplica el factor ×100.
   */
  async getFxRates(base: string, currencies: (string | null)[]): Promise<Record<string, number>> {
    const rates: Record<string, number> = { [base]: 1 };
    const majors = new Set<string>();
    for (const c of currencies) if (c) majors.add(MINOR_UNITS[c]?.major ?? c);
    majors.delete(base);
    const pairs = [...majors].map((c) => `${base}${c}=X`);
    const quotes = await this.getQuotes(pairs);
    for (const c of majors) {
      const p = quotes.get(`${base}${c}=X`)?.price;
      if (p) rates[c] = p;
    }
    for (const c of currencies) {
      const minor = c ? MINOR_UNITS[c] : undefined;
      if (c && minor && rates[minor.major]) rates[c] = rates[minor.major]! * minor.factor;
    }
    return rates;
  }

  /**
   * Búsqueda por nombre o ticker; si es un ISIN, se traduce con OpenFIGI a tickers de Yahoo y se comprueban.
   * Con ISIN se juntan los resultados de las fuentes directas (fondos, bolsas alemanas de onvista) y los de Yahoo.
   */
  async search(query: string): Promise<SymbolSearchResult[]> {
    if (!isIsin(query)) return this.byName(query);
    const direct = await this.provider.search(query).catch(() => [] as SymbolSearchResult[]);
    // Las bolsas de onvista van al final: Yahoo da además gráficos e históricos.
    const venues = direct.filter((r) => isVenueSymbol(r.symbol));
    const ft = direct.filter((r) => parseFtSymbol(r.symbol));
    const own = direct.filter((r) => !isVenueSymbol(r.symbol) && !parseFtSymbol(r.symbol));
    // FT encuentra casi cualquier ISIN: no cuenta como fuente directa para dejar de consultar Yahoo.
    return [...(own.length ? own : await this.isinYahoo(query)), ...ft, ...venues];
  }

  /**
   * Productos que encajan con un nombre, ISIN o WKN (paso 1 del buscador: qué valor es). Además del catálogo, los
   * tickers de Yahoo que llevan el ISIN en el símbolo (p. ej. JE00B588CD74.SG) también son un producto. Primero los
   * que más palabras de la búsqueda tienen en el nombre.
   */
  async instruments(query: string): Promise<InstrumentHit[]> {
    const [catalog, tickers] = await Promise.all([
      this.catalog
        ? this.catalog.findInstruments(query).catch((err) => (this.log(`No se pudo buscar el producto «${query}»`, err), []))
        : [],
      isIsin(query) || query.trim().length < 3 ? [] : this.byName(query).catch(() => [] as SymbolSearchResult[]),
    ]);
    const fromTickers = tickers.flatMap((r) => {
      const isin = /^(?:FT:)?([A-Z]{2}[A-Z0-9]{9}\d)[.:][A-Z]+$/.exec(r.symbol)?.[1];
      // Yahoo marca estos símbolos de Stuttgart como fondo aunque sean ETC o acciones: mejor sin tipo que uno falso.
      return isin && isIsin(isin) ? [{ isin, name: r.name, type: null }] : [];
    });
    const words = queryWords(query);
    const byIsin = new Map<string, InstrumentHit>();
    for (const hit of [...catalog, ...fromTickers]) if (!byIsin.has(hit.isin)) byIsin.set(hit.isin, hit);
    return [...byIsin.values()]
      .map((hit, order) => ({ hit, order, score: wordScore(hit.name, words) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((x) => x.hit)
      .slice(0, 12);
  }

  /**
   * Búsqueda por nombre o ticker. Si un nombre largo no da nada, reintenta por parejas de palabras y deja los
   * resultados que tienen al menos dos palabras de la búsqueda.
   */
  private async byName(query: string): Promise<SymbolSearchResult[]> {
    const found = await this.provider.search(query);
    const pairs = wordPairs(query);
    if (found.length || !pairs.length) return found;
    const lists = await Promise.all(pairs.map((p) => this.provider.search(p).catch(() => [] as SymbolSearchResult[])));
    return rankByWords(query, lists, (r) => r.symbol, (r) => r.name);
  }

  /**
   * Bolsas donde se puede seguir un ISIN, con su precio (paso 2: dónde). Primero las que tienen gráfico.
   * Se juntan: lo que las fuentes dan por ISIN, la traducción de OpenFIGI y los tickers de Yahoo con el mismo nombre
   * de producto (Yahoo no encuentra por ISIN, p. ej., SGBS.MI ni GZURD.XD).
   */
  async listings(isin: string): Promise<Listing[]> {
    const [direct, figi, named] = await Promise.all([
      this.provider.search(isin).catch(() => [] as SymbolSearchResult[]),
      this.isinYahoo(isin),
      this.instruments(isin).then(async ([product]) =>
        product ? (await this.byName(product.name).catch(() => [])).filter((r) => sameName(r.name, product.name)) : [],
      ),
    ]);
    const bySymbol = new Map<string, SymbolSearchResult>();
    for (const r of [...direct, ...figi, ...named]) if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
    const found = [...bySymbol.values()].slice(0, 24);
    const quotes = await this.getQuotes(found.map((r) => r.symbol));
    return found
      .map((r) => {
        const q = quotes.get(r.symbol);
        const priceOnly = isVenueSymbol(r.symbol) || q?.source === 'onvista';
        return {
          ...r,
          exchange: (priceOnly ? q?.exchange : null) ?? r.exchange,
          currency: q?.currency ?? null,
          price: q && !q.stale ? q.price : null,
          priceOnly,
        };
      })
      .sort((a, b) => Number(a.priceOnly) - Number(b.priceOnly) || Number(b.price !== null) - Number(a.price !== null));
  }

  private async isinYahoo(query: string): Promise<SymbolSearchResult[]> {
    let candidates: string[] = [];
    try {
      candidates = await isinCandidates(query);
    } catch (err) {
      this.log(`No se pudo traducir el ISIN ${query}`, err);
    }
    if (!candidates.length) return [];
    const quotes = await this.getQuotes(candidates);
    return candidates
      .map((s) => quotes.get(s))
      .filter((q): q is Quote => !!q && !q.stale)
      .map((q) => ({ symbol: q.symbol, name: q.name ?? q.symbol, exchange: q.exchange, type: q.quoteType }));
  }

  /** Histórico de cierres (caché 1 h; sin conexión, el último guardado). */
  async getHistory(symbol: string, range: HistoryRange): Promise<{ points: PricePoint[]; stale: boolean }> {
    const kind = `history-${range}`;
    const key = `${kind}:${symbol}`;
    let hit = this.mem.get(key) as Entry<PricePoint[]> | undefined;
    // Tras un reinicio (cada publicación) la memoria está vacía: lo guardado en la base de datos vale si
    // es reciente, para no pedir a Yahoo el histórico de toda la lista de golpe (eso es lo que le hace limitarnos).
    if (!hit) {
      hit = await this.load<PricePoint[]>(kind, symbol);
      if (hit) this.mem.set(key, hit);
    }
    if (hit && Date.now() - hit.fetchedAt < (hit.value.length ? HISTORY_TTL_MS : EMPTY_HISTORY_TTL_MS)) return { points: hit.value, stale: false };
    if (!this.throttled) {
      try {
        const points = await this.provider.getHistory(symbol, range);
        if (!points.length && hit?.value.length) throw new Error('Sin cierres históricos');
        this.mem.set(key, { value: points, fetchedAt: Date.now() });
        await this.persist(kind, symbol, points);
        return { points, stale: false };
      } catch (err) {
        this.onProviderError(err, `Sin histórico de ${symbol}`);
      }
    }
    const stored = await this.load<PricePoint[]>(kind, symbol);
    return { points: stored?.value ?? [], stale: true };
  }

  /**
   * Cierres del periodo (3 meses por defecto) de varios valores, para los minigráficos de las tablas.
   * Lo guardado se sirve al momento aunque tenga horas; lo viejo se renueva en segundo plano de uno en
   * uno. Pedir a Yahoo el histórico de toda la lista de golpe (p. ej. tras cada publicación) es lo que
   * hace que nos limite.
   */
  async getSparklines(symbols: string[], range: HistoryRange = '3m'): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    const kind = `history-${range}`;
    await mapLimit([...new Set(symbols)], 2, async (sym) => {
      const key = `${kind}:${sym}`;
      let hit = this.mem.get(key) as Entry<PricePoint[]> | undefined;
      if (!hit) {
        hit = await this.load<PricePoint[]>(kind, sym);
        if (hit) this.mem.set(key, hit);
      }
      // Reintentar pronto los vacíos permite aprovechar nuevas fuentes o cobertura recuperada.
      if (hit && (hit.value.length || Date.now() - hit.fetchedAt < EMPTY_HISTORY_TTL_MS)) {
        out[sym] = hit.value.map((p) => p.c);
        if (Date.now() - hit.fetchedAt >= SPARK_TTL_MS) this.queueRefresh(sym, range);
        return;
      }
      out[sym] = (await this.getHistory(sym, range)).points.map((p) => p.c);
    });
    return out;
  }

  private refreshQueue = new Map<string, HistoryRange>();
  private refreshing = false;

  /** Renueva históricos viejos poco a poco, sin bloquear la respuesta. Se para si Yahoo nos limita. */
  private queueRefresh(symbol: string, range: HistoryRange) {
    this.refreshQueue.set(`${range}:${symbol}`, range);
    if (this.refreshing) return;
    this.refreshing = true;
    void (async () => {
      try {
        for (const [k, r] of this.refreshQueue) {
          if (this.throttled) break;
          this.refreshQueue.delete(k);
          const sym = k.slice(r.length + 1);
          const hit = this.mem.get(`history-${r}:${sym}`);
          if (hit && Date.now() - hit.fetchedAt < SPARK_TTL_MS) continue;
          this.mem.delete(`history-${r}:${sym}`);
          await this.getHistory(sym, r).catch(() => {});
          await new Promise((res) => setTimeout(res, REFRESH_GAP_MS));
        }
      } finally {
        this.refreshQueue.clear();
        this.refreshing = false;
      }
    })();
  }

  /** Ficha de la empresa (sector y nombre). Cambia poco: se guarda 30 días. null si no hay. */
  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    if (!this.provider.getProfile) return null;
    const stored = await this.load<CompanyProfile | null>('profile', symbol);
    if (stored && Date.now() - stored.fetchedAt < PROFILE_TTL_MS) return stored.value;
    if (this.throttled) return stored?.value ?? null;
    try {
      const profile = await this.provider.getProfile(symbol);
      await this.persist('profile', symbol, profile);
      return profile;
    } catch (err) {
      this.onProviderError(err, `Sin ficha de ${symbol}`);
      return stored?.value ?? null;
    }
  }

  private compositionPending = new Map<string, Promise<FundComposition | null>>();

  /** Mayores posiciones de un fondo o ETF, de la primera fuente que las tenga. null si ninguna lo conoce. */
  getComposition(ref: CompositionRef): Promise<FundComposition | null> {
    const key = (ref.isin ?? ref.symbol ?? '').toUpperCase();
    if (!key || !this.compositionSources.length) return Promise.resolve(null);
    const pending = this.compositionPending.get(key);
    if (pending) return pending;
    const request = this.loadComposition(key, ref).finally(() => this.compositionPending.delete(key));
    this.compositionPending.set(key, request);
    return request;
  }

  private async loadComposition(key: string, ref: CompositionRef): Promise<FundComposition | null> {
    const stored = await this.load<FundComposition | null>(COMPOSITION_KIND, key);
    if (stored && Date.now() - stored.fetchedAt < (stored.value ? COMPOSITION_TTL_MS : NO_COMPOSITION_TTL_MS)) return stored.value;
    let failed = false;
    for (const source of this.compositionSources) {
      try {
        const found = await source.getComposition(ref);
        if (!found) continue;
        const value: FundComposition = { ...found, source: source.id, fetchedAt: new Date().toISOString() };
        await this.persist(COMPOSITION_KIND, key, value);
        return value;
      } catch (err) {
        failed = true;
        this.log(`Sin composición de ${key} en ${source.id}; se prueba la siguiente fuente`, err);
      }
    }
    // Mejor la última conocida que nada; «no existe» solo se recuerda si todas las fuentes han contestado.
    if (stored?.value) return stored.value;
    if (!failed) await this.persist(COMPOSITION_KIND, key, null);
    return null;
  }

  /** Guarda el último dato (si falla la base de datos, se sigue con la memoria). */
  private async persist(kind: Kind, symbol: string, value: unknown) {
    try {
      await this.db.query(
        `INSERT INTO market_cache (kind, symbol, data, fetched_at) VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (kind, symbol) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
        [kind, symbol, JSON.stringify(value)],
      );
    } catch (err) {
      this.log(`No se pudo guardar ${kind} de ${symbol}`, err);
    }
  }

  private async load<T>(kind: Kind, symbol: string): Promise<Entry<T> | undefined> {
    try {
      const row = await this.db.one<{ data: T; fetched_at: Date | string }>(
        'SELECT data, fetched_at FROM market_cache WHERE kind = $1 AND symbol = $2',
        [kind, symbol],
      );
      return row ? { value: row.data, fetchedAt: new Date(row.fetched_at).getTime() } : undefined;
    } catch {
      return undefined;
    }
  }
}
