import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackProvider } from './fallback.provider.ts';
import type { MarketDataProvider } from './provider.ts';
import { QuefondosProvider, parseQuefondosPage } from './quefondos.provider.ts';

const isin = 'IE00B3VXGD32';
const url = `https://www1.quefondos.com/es/fondos/ficha/index.html?isin=${isin}`;
const field = (label: string, value: string) => `<p><span class="floatleft">${label}: </span><span class="floatright">${value}</span></p>`;
const page = `${field('ISIN', isin)}${field('Divisa', 'EUR')}${field('Valor liquidativo', '65,350000 EUR')}
${field('Fecha', '09/11/2025')}${field('1 d&iacute;a', '<span class="mas">2,64%</span>')}
<script>var label_fondo = "Polar Biotechnology R EUR Dis";
var fondo = [["10/31/2024",42.37],["10/31/2025",63.29],["09/30/2025",62.07]];
var categoria = [["10/31/2025",99999]];</script>`;

afterEach(() => vi.useRealTimers());
describe('Quefondos / VDOS', () => {
  it('lee NAV, fecha e ISIN exactos y solo la serie del fondo, ordenada y sin rellenar días', () => {
    const data = parseQuefondosPage(page, isin, url);
    expect(data?.quote).toMatchObject({ symbol: isin, name: 'Polar Biotechnology R EUR Dis', price: 65.35,
      currency: 'EUR', previousClose: null, changePct: 0.0264, asOf: '2025-11-09', isin, sourceUrl: url });
    expect(data?.monthly).toEqual([
      { t: '2024-10-31', c: 42.37 }, { t: '2025-09-30', c: 62.07 },
      { t: '2025-10-31', c: 63.29 }, { t: '2025-11-09', c: 65.35 },
    ]);
  });
  it.each([
    page.replace(isin, 'IE00B3WVRB16'), page.replace('65,350000', 'N.D.'),
    page.replace('65,350000', '0'), page.replace('65,350000', '1,234.56'),
    page.replace('65,350000 EUR', '65,350000 USD'), page.replace('09/11/2025', '31/02/2025'),
    page.replace('09/11/2025', '09/11/2099'), page.replace('var label_fondo', 'var otra'),
  ])('rechaza clases, divisas o fechas incoherentes y NAV inválidos', html => {
    expect(parseQuefondosPage(html, isin, url)).toBeNull();
  });
  it.each([
    page.replace('var fondo', 'var otra'), page.replace('63.29', '-1'),
    page.replace('10/31/2025', '02/31/2025'), page.replace('10/31/2025', '12/31/2099'),
    page.replace('63.29', 'null'), page.replace('63.29', '"63.29"'),
  ])('mantiene el NAV si falla la serie, sin aceptar datos de la categoría', html => {
    expect(parseQuefondosPage(html, isin, url)).toMatchObject({ quote: { price: 65.35 }, monthly: null });
  });
  it('descarta una observación posterior a la fecha del NAV y conserva la fecha comprobada', () => {
    const html = page.replace('09/11/2025', '06/11/2025').replace('["10/31/2024",42.37]', '["11/09/2025",65.35]');
    expect(parseQuefondosPage(html, isin, url)?.monthly).toEqual([
      { t: '2025-09-30', c: 62.07 }, { t: '2025-10-31', c: 63.29 }, { t: '2025-11-06', c: 65.35 },
    ]);
  });
  it('comparte peticiones, filtra el periodo y no ofrece las observaciones mensuales como cierres diarios', async () => {
    vi.useFakeTimers({ now: new Date('2025-11-11T12:00:00Z') });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(page));
    const provider: MarketDataProvider = new QuefondosProvider(fetcher);
    const [quotes, history, search] = await Promise.all([
      provider.getQuotes([isin]), provider.getHistory(isin, '1y'), provider.search(isin),
    ]);
    expect(quotes[0]?.price).toBe(65.35);
    expect(history).toEqual([{ t: '2025-09-30', c: 62.07 }, { t: '2025-10-31', c: 63.29 }, { t: '2025-11-09', c: 65.35 }]);
    expect(await provider.getHistory(isin, '1m')).toHaveLength(2);
    expect(search[0]?.symbol).toBe(isin);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(url);
    expect(provider.getDailyHistory).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1);
    await provider.getQuotes([isin]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['0P00016YQ5.F', 'ES0112611001'], ['0P0001F2GG.F', 'ES0112602000'],
    ['0P00019OVT.F', 'IE00BDGV0290'], ['0P0001OJNQ.F', 'LU2441282899'],
  ])('resuelve %s a su clase verificada y conserva el símbolo guardado', async (symbol, mappedIsin) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(page.replace(isin, mappedIsin)));
    const provider = new QuefondosProvider(fetcher);
    expect((await provider.getQuotes([symbol]))[0]).toMatchObject({ symbol, isin: mappedIsin, price: 65.35 });
    expect((await provider.search(mappedIsin))[0]?.symbol).toBe(symbol);
    expect((await provider.getQuotes([mappedIsin]))[0]?.symbol).toBe(mappedIsin);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('omite símbolos ajenos y recuerda un ISIN sin cobertura, sin buscar por semejanza de nombre', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 404 }));
    const provider = new QuefondosProvider(fetcher);
    expect(await provider.getQuotes(['AAPL', 'EURUSD=X', 'BORSA:2FADB12345'])).toEqual([]);
    expect(await provider.search('Polar Biotechnology')).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await provider.getQuotes([isin])).toEqual([]);
    expect(await provider.getHistory(isin, '1y')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recupera precio e histórico mensual cuando fallan las dos primeras fuentes', async () => {
    vi.useFakeTimers({ now: new Date('2025-11-11T12:00:00Z') });
    const unavailable = (id: string, status: number): MarketDataProvider => ({ id,
      async getQuotes() { throw new Error(`HTTP ${status}`); }, async getHistory() { throw new Error(`HTTP ${status}`); },
      async search() { return []; }, async getTargets() { return null; },
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(page.replace(isin, 'LU2441282899')));
    const chain = new FallbackProvider([unavailable('yahoo', 503), unavailable('borsa', 429), new QuefondosProvider(fetcher)]);
    expect((await chain.getQuotes(['0P0001OJNQ.F']))[0]).toMatchObject({ symbol: '0P0001OJNQ.F', source: 'Quefondos / VDOS', price: 65.35 });
    expect(await chain.getHistory('0P0001OJNQ.F', '1y')).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
