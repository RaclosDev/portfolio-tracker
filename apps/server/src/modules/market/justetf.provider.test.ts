import { describe, expect, it, vi } from 'vitest';
import { closes, justEtfIsin, JustEtfProvider, toQuote } from './justetf.provider.ts';

const ISIN = 'IE00B4L5Y983';
const quote = {
  latestQuote: { raw: 127.32 }, latestQuoteDate: '2026-11-17', previousQuote: { raw: 130.01 }, quoteTradingVenue: 'XETRA',
  quoteLowHigh: { low: { raw: 107.06 }, high: { raw: 131.96 } },
};
const chart = { series: [
  { date: '2026-11-13', value: { raw: 130.63 } }, { date: '2026-11-14', value: { raw: 130.63 } }, { date: '2026-11-15', value: { raw: 130.63 } },
  { date: '2026-11-16', value: { raw: 130.01 } }, { date: '2026-11-17', value: { raw: 127.32 } }, { date: 'mal', value: { raw: 1 } },
] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('justETF', () => {
  it('solo cotiza el ISIN solo o en Xetra', () => {
    expect(justEtfIsin(ISIN)).toBe(ISIN);
    expect(justEtfIsin(`xetra:${ISIN}`)).toBe(ISIN);
    expect(justEtfIsin(`TRADEGATE:${ISIN}`)).toBeNull();
    expect(justEtfIsin('IWDA.AS')).toBeNull();
  });

  it('convierte su cotización, siempre en euros', () => {
    expect(toQuote(quote, `XETRA:${ISIN}`)).toMatchObject({
      symbol: `XETRA:${ISIN}`, currency: 'EUR', price: 127.32, previousClose: 130.01, low52: 107.06, high52: 131.96,
      exchange: 'Xetra (justETF)', source: 'justETF', asOf: '2026-11-17', isin: ISIN,
    });
    expect(toQuote(quote, ISIN)!.changePct).toBeCloseTo(127.32 / 130.01 - 1);
    expect(toQuote({ latestQuote: { raw: 0 } }, ISIN)).toBeNull();
    // Un rango anual que no contiene el precio no se muestra.
    expect(toQuote({ ...quote, quoteLowHigh: { low: { raw: 200 }, high: { raw: 300 } } }, ISIN)).toMatchObject({ low52: null, high52: null });
  });

  it('quita del histórico los fines de semana, que justETF rellena con el último cierre', () => {
    expect(closes(chart)).toEqual([{ t: '2026-11-13', c: 130.63 }, { t: '2026-11-16', c: 130.01 }, { t: '2026-11-17', c: 127.32 }]);
  });

  it('pide solo sus símbolos y un ISIN desconocido no es un fallo', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('XX0000000009')) return json({}, 404);
      return json(url.includes('performance-chart') ? chart : quote);
    });
    const provider = new JustEtfProvider(fetcher);
    const quotes = await provider.getQuotes([ISIN, `TRADEGATE:${ISIN}`, 'IWDA.AS', 'XX0000000009']);
    expect(quotes.map((q) => q.symbol)).toEqual([ISIN]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await provider.getDailyHistory(`XETRA:${ISIN}`, '2026-11-16')).toEqual({
      currency: 'EUR', points: [{ t: '2026-11-16', c: 130.01 }, { t: '2026-11-17', c: 127.32 }],
    });
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain(`${ISIN}/performance-chart?`);
    expect(await provider.getHistory('IWDA.AS', '1m')).toEqual([]);
    expect(await provider.getDailyHistory('XX0000000009', '2026-11-01')).toEqual({ currency: null, points: [] });
  });

  it('propaga el error si la fuente no responde', async () => {
    const provider = new JustEtfProvider(vi.fn<typeof fetch>(async () => json({}, 503)));
    await expect(provider.getQuotes([ISIN])).rejects.toThrow(/503/);
  });
});
