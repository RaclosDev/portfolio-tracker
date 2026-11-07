import type { AnalystTargets, Quote } from '@watchlist/shared';
import type { Db } from '../../db/database.ts';
import type { MarketDataProvider } from './provider.ts';

type Kind = 'quote' | 'targets';
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
export class MarketService {
  private mem = new Map<string, Entry<unknown>>();

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
    try {
      fetched = await this.provider.getQuotes(missing);
    } catch (err) {
      this.log(`No se pudieron obtener cotizaciones (${missing.join(', ')})`, err);
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
      if (!force && cached && Date.now() - cached.fetchedAt < this.opts.targetsTtlMs) {
        this.mem.set(key, cached);
        out.set(sym, cached.value);
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
        this.log(`Sin consenso para ${sym}`, err);
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

  search(query: string) {
    return this.provider.search(query);
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
