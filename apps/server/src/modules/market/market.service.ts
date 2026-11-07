import type { AnalystTargets, HistoryRange, PricePoint, Quote, SymbolSearchResult } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';
import { isinCandidates, isIsin } from './isin.ts';
import type { MarketDataProvider } from './provider.ts';

type Kind = string; // 'quote' | 'targets' | 'history-<periodo>'
const HISTORY_TTL_MS = 60 * 60_000;
interface Entry<T> {
  value: T;
  fetchedAt: number;
}

/** Divisas que cotizan en centésimas (Londres en peniques, Tel Aviv en agorot…). */
const MINOR_UNITS: Record<string, { major: string; factor: number }> = {
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
  ) {}

  get providerId() {
    return this.provider.id;
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
    for (const sym of missing) {
      const q = bySymbol.get(sym.toUpperCase());
      if (q) {
        const quote: Quote = { ...q, symbol: sym, stale: false };
        this.mem.set(`quote:${sym}`, { value: quote, fetchedAt: now });
        this.persist('quote', sym, quote);
        out.set(sym, quote);
      } else {
        const stored = this.load<Quote>('quote', sym);
        if (stored) out.set(sym, { ...stored.value, stale: true });
      }
    }
    return out;
  }

  async getTargets(symbols: string[], { force = false } = {}): Promise<Map<string, AnalystTargets | null>> {
    const out = new Map<string, AnalystTargets | null>();
    await mapLimit([...new Set(symbols)], 4, async (sym) => {
      const key = `targets:${sym}`;
      const cached =
        (this.mem.get(key) as Entry<AnalystTargets | null> | undefined) ?? this.load<AnalystTargets | null>('targets', sym);
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
        this.persist('targets', sym, value);
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

  /** Búsqueda por nombre o ticker; si es un ISIN, se traduce con OpenFIGI y se comprueba en el proveedor. */
  async search(query: string): Promise<SymbolSearchResult[]> {
    if (!isIsin(query)) return this.provider.search(query);
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
    const hit = this.mem.get(key) as Entry<PricePoint[]> | undefined;
    if (hit && Date.now() - hit.fetchedAt < HISTORY_TTL_MS) return { points: hit.value, stale: false };
    if (!this.throttled) {
      try {
        const points = await this.provider.getHistory(symbol, range);
        this.mem.set(key, { value: points, fetchedAt: Date.now() });
        this.persist(kind, symbol, points);
        return { points, stale: false };
      } catch (err) {
        this.onProviderError(err, `Sin histórico de ${symbol}`);
      }
    }
    const stored = this.load<PricePoint[]>(kind, symbol);
    return { points: stored?.value ?? [], stale: true };
  }

  /** Cierres de los últimos 3 meses de varios valores, para los minigráficos de la tabla. */
  async getSparklines(symbols: string[]): Promise<Record<string, number[]>> {
    const out: Record<string, number[]> = {};
    await mapLimit([...new Set(symbols)], 4, async (sym) => {
      out[sym] = (await this.getHistory(sym, '3m')).points.map((p) => p.c);
    });
    return out;
  }

  private persist(kind: Kind, symbol: string, value: unknown) {
    this.db
      .prepare(
        `INSERT INTO market_cache (kind, symbol, data, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, symbol) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(kind, symbol, JSON.stringify(value), new Date().toISOString());
  }

  private load<T>(kind: Kind, symbol: string): Entry<T> | undefined {
    const row = this.db
      .prepare('SELECT data, fetched_at FROM market_cache WHERE kind = ? AND symbol = ?')
      .get(kind, symbol) as { data: string; fetched_at: string } | undefined;
    return row ? { value: JSON.parse(row.data) as T, fetchedAt: Date.parse(row.fetched_at) } : undefined;
  }
}
