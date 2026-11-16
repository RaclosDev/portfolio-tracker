import type { InstrumentHit, Quote, SymbolSearchResult } from '@watchlist/shared';
import { isIsin } from './isin.ts';
import { rankByWords, wordPairs } from './words.ts';
import type { InstrumentCatalog, MarketDataProvider } from './provider.ts';

/*
 * Cotizaciones de onvista.de (API JSON pública de su web). Cubre lo que Yahoo no tiene o tiene sin precio:
 * ETF y ETC en Xetra, Tradegate y otras bolsas alemanas (p. ej. GZUR en Xetra), además de cualquier ISIN.
 * Símbolos: «XETRA:JE00B588CD74» (bolsa concreta) o el ISIN solo (bolsa principal según onvista).
 * Solo precio actual: onvista no deja descargar su histórico.
 */
const API = 'https://api.onvista.de/api/v1';
const SOURCE = 'onvista';
const QUOTE_TTL = 60_000;
const INSTRUMENT_TTL = 24 * 60 * 60_000;

/** Prefijo del símbolo → código de bolsa de onvista. Solo las que Yahoo no cubre bien (Milán, Ámsterdam… ya las tiene). */
export const VENUES: Readonly<Record<string, { code: string; name: string }>> = {
  XETRA: { code: 'GER', name: 'Xetra' },
  TRADEGATE: { code: 'GAT', name: 'Tradegate' },
  FRANKFURT: { code: 'FRA', name: 'Frankfurt' },
  GETTEX: { code: 'TRO', name: 'gettex' },
  LSX: { code: 'LSX', name: 'LS Exchange' },
  STUTTGART: { code: 'STU', name: 'Stuttgart' },
};
const VENUE_SYMBOL = new RegExp(`^(${Object.keys(VENUES).join('|')}):([A-Z]{2}[A-Z0-9]{9}\\d)$`);

/** Bolsa e ISIN de un símbolo que cotiza onvista, o null si no es suyo. */
export function parseOnvistaSymbol(symbol: string): { venue: string | null; isin: string } | null {
  const s = symbol.trim().toUpperCase();
  const m = VENUE_SYMBOL.exec(s);
  if (m) return { venue: m[1]!, isin: m[2]! };
  return isIsin(s) ? { venue: null, isin: s } : null;
}
export const isVenueSymbol = (symbol: string) => VENUE_SYMBOL.test(symbol.trim().toUpperCase());

interface Instrument {
  entityType: string;
  entitySubType?: string;
  entityValue: string;
  name: string;
  isin?: string;
  displayType?: string;
  urls?: { WEBSITE?: string };
}
interface OnvistaQuote {
  market?: { name?: string; codeExchange?: string };
  isoCurrency?: string;
  last?: number;
  previousLast?: number;
  datetimeLast?: string;
  lowPrice1Year?: number;
  highPrice1Year?: number;
}
interface Snapshot {
  instrument?: Instrument;
  quote?: OnvistaQuote;
  quoteList?: { list?: OnvistaQuote[] };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function quoteType(i: Instrument): string | null {
  if (i.entityType === 'STOCK') return 'EQUITY';
  if (i.entityType === 'FUND') return /ETF/i.test(i.displayType ?? '') ? 'ETF' : 'MUTUALFUND';
  if (i.entitySubType === 'ETC_ETN_CERTIFICATE') return 'ETF';
  return null;
}

/** Cotización de una bolsa concreta (la más reciente si onvista da varias) o la principal si no se pide ninguna. */
export function pickQuote(snapshot: Snapshot, venue: string | null): OnvistaQuote | null {
  if (!venue) return snapshot.quote ?? null;
  const code = VENUES[venue]?.code;
  const list = (snapshot.quoteList?.list ?? []).filter((q) => q.market?.codeExchange === code && num(q.last));
  return list.sort((a, b) => (b.datetimeLast ?? '').localeCompare(a.datetimeLast ?? ''))[0] ?? null;
}

export function toQuote(snapshot: Snapshot, symbol: string): Omit<Quote, 'stale'> | null {
  const parsed = parseOnvistaSymbol(symbol);
  const instrument = snapshot.instrument;
  if (!parsed || !instrument || instrument.isin !== parsed.isin) return null;
  const q = pickQuote(snapshot, parsed.venue);
  const price = num(q?.last);
  const currency = q?.isoCurrency;
  if (!q || !price || price <= 0 || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const previousClose = num(q.previousLast);
  const prev = previousClose && previousClose > 0 ? previousClose : null;
  const low = num(q.lowPrice1Year);
  const high = num(q.highPrice1Year);
  // El rango anual solo si es coherente con el precio (onvista a veces lo arrastra de otra serie).
  const range = low && high && low <= price && price <= high;
  return {
    symbol,
    name: instrument.name,
    currency,
    price,
    previousClose: prev,
    changePct: prev ? price / prev - 1 : null,
    low52: range ? low : null,
    high52: range ? high : null,
    quoteType: quoteType(instrument),
    exchange: q.market?.name ?? null,
    marketState: null,
    source: SOURCE,
    sourceUrl: instrument.urls?.WEBSITE,
    asOf: q.datetimeLast?.slice(0, 10),
    isin: parsed.isin,
    fetchedAt: new Date().toISOString(),
  };
}

export class OnvistaProvider implements MarketDataProvider, InstrumentCatalog {
  readonly id = 'onvista';
  private instruments = new Map<string, { value: Instrument | null; expires: number }>();
  private snapshots = new Map<string, { value: Snapshot; expires: number }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private fetcher: typeof fetch = fetch) {}

  private async json(path: string): Promise<unknown> {
    const res = await this.fetcher(`${API}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`onvista HTTP ${res.status}`);
    return res.json();
  }

  /** Comparte la petición si ya hay una en curso para la misma clave. */
  private once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = this.pending.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = run().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private async query(text: string, limit: number): Promise<Instrument[]> {
    const data = (await this.json(`/instruments/query?limit=${limit}&searchValue=${encodeURIComponent(text)}`)) as { list?: unknown };
    return Array.isArray(data?.list)
      ? (data.list as Instrument[]).filter((i) => i && typeof i.entityValue === 'string' && typeof i.entityType === 'string' && typeof i.name === 'string')
      : [];
  }

  private instrument(isin: string): Promise<Instrument | null> {
    const hit = this.instruments.get(isin);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    return this.once(`i:${isin}`, async () => {
      const value = (await this.query(isin, 3)).find((i) => i.isin === isin) ?? null;
      if (this.instruments.size >= 512) this.instruments.delete(this.instruments.keys().next().value!);
      this.instruments.set(isin, { value, expires: Date.now() + INSTRUMENT_TTL });
      return value;
    });
  }

  private snapshot(i: Instrument): Promise<Snapshot> {
    const key = `${i.entityType}/${i.entityValue}`;
    const hit = this.snapshots.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    return this.once(`s:${key}`, async () => {
      const value = (await this.json(`/instruments/${encodeURIComponent(i.entityType)}/${encodeURIComponent(i.entityValue)}/snapshot`)) as Snapshot;
      if (this.snapshots.size >= 512) this.snapshots.delete(this.snapshots.keys().next().value!);
      this.snapshots.set(key, { value, expires: Date.now() + QUOTE_TTL });
      return value;
    });
  }

  async getQuotes(symbols: string[]) {
    const results: Omit<Quote, 'stale'>[] = [];
    let failure: unknown;
    for (const input of symbols) {
      const symbol = input.toUpperCase();
      const parsed = parseOnvistaSymbol(symbol);
      if (!parsed) continue;
      try {
        const instrument = await this.instrument(parsed.isin);
        const quote = instrument && toQuote(await this.snapshot(instrument), symbol);
        if (quote) results.push(quote);
      } catch (error) {
        failure = error;
        if (/\b(403|429)\b/.test(String(error))) break;
      }
    }
    if (failure && !results.length) throw failure;
    return results;
  }

  /** Productos por nombre, ISIN o WKN, sin pedir precios (la bolsa se elige después con search(isin)). */
  async findInstruments(query: string): Promise<InstrumentHit[]> {
    const q = query.trim();
    if (q.length < 3 || q.length > 100) return [];
    const parsed = parseOnvistaSymbol(q);
    const found = parsed ? [await this.instrument(parsed.isin)] : await this.byName(q);
    const hits = new Map<string, InstrumentHit>();
    for (const i of found) {
      if (i?.isin && isIsin(i.isin) && quoteType(i) && !hits.has(i.isin)) hits.set(i.isin, { isin: i.isin, name: i.name, type: quoteType(i) });
    }
    return [...hits.values()].slice(0, 8);
  }

  /** Si un nombre largo no da nada, reintenta por parejas de palabras (ver words.ts). */
  private async byName(q: string): Promise<Instrument[]> {
    // Límite amplio: onvista rellena con futuros, que se descartan después.
    const full = await this.query(q, 30);
    const pairs = wordPairs(q);
    if (full.length || !pairs.length) return full;
    const lists = await Promise.all(pairs.map((p) => this.query(p, 10).catch(() => [] as Instrument[])));
    return rankByWords(q, lists, (i) => i.isin ?? `${i.entityType}/${i.entityValue}`, (i) => i.name);
  }

  /** Por ISIN (o bolsa:ISIN): las bolsas alemanas donde cotiza. Por nombre no busca: eso lo hace findInstruments. */
  async search(query: string): Promise<SymbolSearchResult[]> {
    const parsed = parseOnvistaSymbol(query);
    if (!parsed) return [];
    const instrument = await this.instrument(parsed.isin);
    if (!instrument || !quoteType(instrument)) return [];
    const snap = await this.snapshot(instrument);
    return (parsed.venue ? [parsed.venue] : Object.keys(VENUES))
      .filter((v) => pickQuote(snap, v))
      .map((venue) => ({
        symbol: `${venue}:${instrument.isin}`,
        name: `${instrument.name} · ${instrument.isin}`,
        exchange: `${VENUES[venue]!.name} (onvista)`,
        type: quoteType(instrument),
      }));
  }

  async getTargets() {
    return null;
  }
  async getHistory() {
    return [];
  }
}
