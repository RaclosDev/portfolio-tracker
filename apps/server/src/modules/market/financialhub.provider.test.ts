import { describe, expect, it, vi } from 'vitest';
import { FinancialHubProvider, wantedFor } from './financialhub.provider.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const nvda = { type: 'listing', instrumentId: 149480, listingId: 291587, name: 'NVIDIA Corp', symbol: 'NVDA', isin: 'US67066G1040', currency: 'USD', mic: 'XNAS' };
const chip = { type: 'listing', instrumentId: 900, listingId: 777, name: 'Amundi MSCI Semiconductors', symbol: 'CHIP', isin: 'LU1900066033', currency: 'EUR', mic: 'XPAR' };
const fund = { type: 'class', instrumentId: 154634, name: 'Fondo Ejemplo A', isin: 'ES0000000001', currency: 'EUR' };

const fakeFh = () => vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input));
  const q = url.searchParams.get('q');
  if (url.pathname === '/search') {
    if (q === 'NVDA') return json({ data: [{ type: 'stock', id: 149480, name: 'NVIDIA', primary: nvda, matchedChild: nvda }] });
    if (q === 'CHIP') return json({ data: [{ type: 'etf', id: 900, name: 'Amundi', primary: { ...chip, listingId: 778, mic: 'XETR', symbol: 'LSMC' }, matchedChild: chip }] });
    if (q === 'SAN') return json({ data: [{ type: 'stock', id: 1, primary: { ...nvda, symbol: 'SAN', mic: 'XMAD', currency: 'EUR', listingId: 1 } }, { type: 'stock', id: 2, primary: { ...nvda, symbol: 'SAN', mic: 'XNYS', listingId: 2 } }] });
    if (q === 'ES0000000001') return json({ data: [{ type: 'fund', id: 1, name: 'Fondo Ejemplo', matchedChild: fund }] });
    return json({ data: [] });
  }
  if (url.pathname === '/market/quotes') {
    const listings = url.searchParams.get('listingIds')?.split(',') ?? [];
    const classes = url.searchParams.get('instrumentIds')?.split(',') ?? [];
    return json({ data: [
      ...listings.map((id) => ({ ref: { listingId: Number(id) }, quote: { price: id === '291587' ? 150.97 : 70, previousClose: 155.65, changePct: -3, tradingDate: '2026-11-18', marketPhase: 'regular' } })),
      ...classes.map((id) => ({ ref: { instrumentId: Number(id) }, quote: { price: 62.67, previousClose: 63.41, changePct: -1.17, tradingDate: '2026-11-17', currency: 'EUR' } })),
    ] });
  }
  if (url.pathname.startsWith('/market/series/')) {
    const kind = url.searchParams.get('kind');
    const points = kind === 'listing'
      ? [{ time: '2026-01-02', close: 100 }, { time: '2026-06-01', close: 200 }]
      : [{ time: '2026-11-14', value: 62 }, { time: '2026-11-17', value: 62.67 }];
    return json({ data: { currency: kind === 'listing' ? (url.pathname.includes('291587') ? 'USD' : 'EUR') : 'EUR', points, nextCursor: null } });
  }
  return new Response('', { status: 404 });
});

describe('Financial Hub (precios)', () => {
  it('traduce los símbolos de la app a lo que hay que buscar', () => {
    expect(wantedFor('NVDA')).toMatchObject({ by: 'ticker', root: 'NVDA', mics: expect.arrayContaining(['XNAS', 'XNYS']) });
    expect(wantedFor('CHIP.PA')).toEqual({ by: 'ticker', root: 'CHIP', mics: ['XPAR'], currency: null });
    expect(wantedFor('FT:SEC0:GER:EUR')).toEqual({ by: 'ticker', root: 'SEC0', mics: ['XETR'], currency: 'EUR' });
    expect(wantedFor('ES0000000001')).toEqual({ by: 'fund', isin: 'ES0000000001', currency: null });
    expect(wantedFor('XETRA:IE00B4L5Y983')).toEqual({ by: 'isin', isin: 'IE00B4L5Y983', mics: ['XETR'] });
    // Londres (peniques) y sufijos desconocidos se quedan para las otras fuentes.
    for (const s of ['VUSA.L', 'FT:VUSA:LSE:GBX', 'ABC.XX', 'OTRA:ABC']) expect(wantedFor(s)).toBeNull();
  });

  it('cotiza acciones, ETF y fondos con su fuente, divisa y rango de 52 semanas', async () => {
    const fh = new FinancialHubProvider(fakeFh());
    const quotes = await fh.getQuotes(['nvda', 'CHIP.PA', 'ES0000000001', 'SAN']);
    expect(quotes).toHaveLength(4);
    expect(quotes[0]).toMatchObject({
      symbol: 'NVDA', price: 150.97, currency: 'USD', changePct: -0.03, previousClose: 155.65, quoteType: 'EQUITY',
      exchange: 'Nasdaq', marketState: 'REGULAR', low52: 100, high52: 200, source: 'Financial Hub', isin: 'US67066G1040',
      sourceUrl: 'https://financial-hub.es/stock/US67066G1040?listingId=291587',
    });
    expect(quotes[0]).not.toHaveProperty('asOf');
    expect(quotes[1]).toMatchObject({ symbol: 'CHIP.PA', price: 70, currency: 'EUR', quoteType: 'ETF', exchange: 'París' });
    expect(quotes[2]).toMatchObject({ symbol: 'ES0000000001', price: 62.67, quoteType: 'MUTUALFUND', asOf: '2026-11-17', low52: 62, high52: 62.67 });
  });

  it('sin sufijo solo vale una bolsa de EE. UU.; si la divisa no cuadra, no contesta', async () => {
    const fh = new FinancialHubProvider(fakeFh());
    expect(await fh.resolve('SAN')).toMatchObject({ id: 2 });
    expect(await fh.resolve('FT:CHIP:PAR:USD')).toBeNull();
    expect(await fh.resolve('ES0000000001')).toMatchObject({ kind: 'fund_class', id: 154634 });
  });

  it('guarda lo resuelto y no repite búsquedas', async () => {
    const fetcher = fakeFh();
    const fh = new FinancialHubProvider(fetcher);
    await fh.resolve('NVDA');
    await fh.resolve('nvda');
    expect(fetcher.mock.calls.filter(([u]) => String(u).includes('/search')).length).toBe(1);
  });

  it('histórico de todo; el diario solo de fondos (sin splits)', async () => {
    const fh = new FinancialHubProvider(fakeFh());
    expect(await fh.getHistory('NVDA', '1y')).toEqual([{ t: '2026-01-02', c: 100 }, { t: '2026-06-01', c: 200 }]);
    expect(await fh.getDailyHistory('NVDA', '2026-01-01')).toEqual({ currency: null, points: [] });
    expect(await fh.getDailyHistory('ES0000000001', '2026-11-15')).toEqual({ currency: 'EUR', points: [{ t: '2026-11-17', c: 62.67 }] });
  });

  it('si la API corta por límite, deja paso a las demás fuentes', async () => {
    const fh = new FinancialHubProvider(vi.fn<typeof fetch>(async () => new Response('', { status: 429 })));
    await expect(fh.getQuotes(['NVDA'])).rejects.toThrow('429');
  });
});
