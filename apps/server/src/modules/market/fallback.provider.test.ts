import type { Quote } from '@watchlist/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackProvider } from './fallback.provider.ts';
import type { MarketDataProvider } from './provider.ts';

const quote = (symbol: string, price: number | null = 25): Omit<Quote, 'stale'> => ({ symbol, price,
  currency: 'EUR', name: symbol, previousClose: null, changePct: null, low52: null, high52: null,
  quoteType: null, exchange: null, marketState: null, fetchedAt: new Date().toISOString() });
const provider = (id: string, quotes: Omit<Quote, 'stale'>[] = []) => ({ id,
  getQuotes: vi.fn<MarketDataProvider['getQuotes']>().mockResolvedValue(quotes),
  getTargets: vi.fn<MarketDataProvider['getTargets']>().mockResolvedValue(null),
  getHistory: vi.fn<MarketDataProvider['getHistory']>().mockResolvedValue([]),
  search: vi.fn<MarketDataProvider['search']>().mockResolvedValue([]),
});

afterEach(() => vi.useRealTimers());
describe('fuentes alternativas', () => {
  it('conserva los precios de la primera fuente y solo busca los pendientes en las siguientes', async () => {
    const primary = provider('yahoo', [quote('A'), quote('B', null), quote('C', NaN), { ...quote('D'), currency: null }]);
    const second = provider('borsa', [quote('B', 40)]);
    const third = provider('third', [quote('C', 30), quote('D', 20)]);
    const chain = new FallbackProvider([primary, second, third]);
    expect(await chain.getQuotes(['a', 'B', 'C', 'D'])).toEqual([quote('A'), quote('B', 40), quote('C', 30), quote('D', 20)].map(q => expect.objectContaining({ symbol: q.symbol, price: q.price })));
    expect(second.getQuotes).toHaveBeenCalledWith(['B', 'C', 'D']);
    expect(third.getQuotes).toHaveBeenCalledWith(['C', 'D']);
  });
  it('el diagnóstico cuenta el último fallo y la pausa de cada fuente, sin los símbolos de la URL', async () => {
    const primary = provider('yahoo');
    primary.getQuotes.mockRejectedValue(new Error('HTTP 429 Too Many Requests en https://query1.example/v7/quote?symbols=SECRETO&crumb=x'));
    const chain = new FallbackProvider([primary, provider('borsa', [quote('A')])]);
    await chain.getQuotes(['A']);
    const state = chain.diagnostics() as Record<string, { pausedUntil: string | null; lastError: { message: string } | null }>;
    expect(state.yahoo!.pausedUntil).not.toBeNull();
    expect(state.yahoo!.lastError!.message).toBe('Error: HTTP 429 Too Many Requests en https://query1.example/v7/quote');
    expect(state.borsa).toEqual({ pausedUntil: null, lastError: null });
  });
  it('un 429 pausa solo la fuente afectada y permite seguir actualizando con otra', async () => {
    vi.useFakeTimers();
    const primary = provider('yahoo');
    primary.getQuotes.mockRejectedValue(new Error('HTTP 429 Too Many Requests'));
    const second = provider('borsa', [quote('A')]);
    const chain = new FallbackProvider([primary, second]);
    expect(await chain.getQuotes(['A'])).toHaveLength(1);
    expect(await chain.getQuotes(['A'])).toHaveLength(1);
    expect(primary.getQuotes).toHaveBeenCalledTimes(1);
    expect(second.getQuotes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_001);
    await chain.getQuotes(['A']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(2);
  });
  it('un fondo desconocido no impide consultar otras acciones ni envía códigos Borsa a Yahoo', async () => {
    const primary = provider('yahoo');
    primary.getQuotes.mockRejectedValueOnce(new Error('HTTP 404 Not Found')).mockResolvedValue([quote('A')]);
    const chain = new FallbackProvider([primary, provider('borsa')]);
    expect(await chain.getQuotes(['UNKNOWN'])).toEqual([]);
    expect(await chain.getQuotes(['A'])).toHaveLength(1);
    await chain.getQuotes(['BORSA:2FADB12345']);
    expect(primary.getQuotes).toHaveBeenCalledTimes(2);
  });
  it('no sustituye un histórico guardado con un resultado vacío cuando el proveedor falla', async () => {
    const primary = provider('yahoo');
    primary.getHistory.mockRejectedValue(new Error('HTTP 503'));
    await expect(new FallbackProvider([primary, provider('borsa')]).getHistory('A', '1y')).rejects.toThrow('fuentes');
  });
});
