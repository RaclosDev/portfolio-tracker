import type { Quote, SymbolSearchResult } from '@watchlist/shared';
import { isIsin } from './isin.ts';
import type { MarketDataProvider } from './provider.ts';

const ORIGIN = 'https://www.borsaitaliana.it';
const SOURCE = 'Borsa Italiana / FIDA';
const HOUR = 60 * 60_000;
// El buscador de Borsa no indexa todos los ISIN. Cada vínculo se valida de nuevo en la ficha.
const FUND_IDS: Readonly<Record<string, string>> = { IE00B3VXGD32: '2FADB302467' };
const fundCode = (symbol: string) => FUND_IDS[symbol] ?? /^BORSA:(2FADB\d+)$/.exec(symbol)?.[1];
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
const cells = (row: string) => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => text(m[1]!));
const decimal = (value: string) => /^[+-]?\d+(?:\.\d{3})*(?:,\d+)?$/.test(value)
  ? Number(value.replace(/\./g, '').replace(',', '.')) : NaN;

export function parseFundPage(html: string, symbol: string, url: string): Omit<Quote, 'stale'> | null {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => cells(m[1]!));
  const isin = rows.find(row => row[0]?.toLowerCase() === 'isin')?.[1];
  if (!isin || !isIsin(isin) || (isIsin(symbol) && isin !== symbol)) return null;
  const header = rows.findIndex(row => row.join('|') === 'Ultima|Precedente|Valuta|Data|Variazione');
  if (header < 0) return null;
  const row = rows[header + 1];
  if (!row || row.length !== 5) return null;
  const [last, previous, currency, date] = row as [string, string, string, string, string];
  const price = decimal(last);
  const previousClose = decimal(previous);
  const parts = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(date);
  if (!parts || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(price) || price <= 0) return null;
  const asOf = `${parts[3]!.length === 2 ? '20' : ''}${parts[3]}-${parts[2]}-${parts[1]}`;
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== asOf || asOf > new Date().toISOString().slice(0, 10)) return null;
  const name = text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  if (!name) return null;
  return { symbol, name, currency, price,
    previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
    changePct: Number.isFinite(previousClose) && previousClose > 0 ? price / previousClose - 1 : null,
    low52: null, high52: null, quoteType: 'MUTUALFUND', exchange: SOURCE, marketState: null,
    source: SOURCE, sourceUrl: url, asOf, isin, fetchedAt: new Date().toISOString() };
}

/** NAV públicos de fondos: la ficha solo ofrece el último dato, no una serie histórica. */
export class BorsaProvider implements MarketDataProvider {
  readonly id = 'borsa';
  private cache = new Map<string, { value: Omit<Quote, 'stale'> | null; expires: number }>();
  private pending = new Map<string, Promise<Omit<Quote, 'stale'> | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  constructor(private fetcher: typeof fetch = fetch) {}

  private request(path: string) {
    const request = this.queue.then(async () => {
      const delay = 500 - (Date.now() - this.lastRequest);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
      const response = await this.fetcher(`${ORIGIN}${path}`, { signal: AbortSignal.timeout(8_000), redirect: 'error' });
      if (!response.ok) throw new Error(`Borsa HTTP ${response.status}`);
      return response.text();
    });
    this.queue = request.catch(() => {});
    return request;
  }

  private async quote(symbol: string): Promise<Omit<Quote, 'stale'> | null> {
    const code = fundCode(symbol);
    if (!code) return null;
    const cached = this.cache.get(symbol);
    if (cached && cached.expires > Date.now()) return cached.value;
    const pending = this.pending.get(symbol);
    if (pending) return pending;
    const request = (async () => {
      const path = `/borsa/fondi/dettaglio/${code}.html?lang=it`;
      const value = parseFundPage(await this.request(path), symbol, `${ORIGIN}${path}`);
      if (!value) throw new Error(`Ficha de fondo inválida: ${symbol}`);
      if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(symbol, { value, expires: Date.now() + HOUR });
      return value;
    })();
    this.pending.set(symbol, request);
    try { return await request; } finally { this.pending.delete(symbol); }
  }

  async getQuotes(symbols: string[]) {
    const results: Omit<Quote, 'stale'>[] = [];
    let failure: unknown;
    for (const symbol of symbols) {
      try { const quote = await this.quote(symbol.toUpperCase()); if (quote) results.push(quote); }
      catch (error) { failure = error; if (/\b429\b/.test(String(error))) break; }
    }
    if (failure && !results.length) throw failure;
    return results;
  }

  async search(query: string): Promise<SymbolSearchResult[]> {
    const symbol = query.trim().toUpperCase();
    if (fundCode(symbol)) {
      const quote = await this.quote(symbol);
      return quote ? [{ symbol, name: `${quote.name} · ${quote.isin}`, exchange: SOURCE, type: 'MUTUALFUND' }] : [];
    }
    if (isIsin(symbol) || query.length < 3 || query.length > 100) return [];
    const data: unknown = JSON.parse(await this.request(`/borsa/searchengine/all/json/search.html?lang=it&q=${encodeURIComponent(query)}`));
    if (!data || typeof data !== 'object' || !('quotes' in data) || !Array.isArray(data.quotes)) return [];
    const results: SymbolSearchResult[] = [];
    for (const item of data.quotes as unknown[]) {
      if (!item || typeof item !== 'object' || !('symbol' in item) || !('title' in item)) continue;
      if (typeof item.symbol !== 'string' || !/^2FADB\d+$/.test(item.symbol) || typeof item.title !== 'string') continue;
      results.push({ symbol: `BORSA:${item.symbol}`, name: text(item.title), exchange: SOURCE, type: 'MUTUALFUND' });
    }
    return results;
  }

  async getTargets() { return null; }
  async getHistory() { return []; }
}
