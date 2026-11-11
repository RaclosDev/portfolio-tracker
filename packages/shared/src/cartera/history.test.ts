import { describe, expect, it } from 'vitest';
import { computePortfolioHistory, portfolioHistoryQuerySchema } from './history.ts';
import { instrumentInputSchema, operationInputSchema, type Operation, type OperationInput } from './schemas.ts';

const op = (input: OperationInput, id = 1): Operation => ({ id, ...operationInputSchema.parse(input) });
const instrument = (ticker: string, currency = 'EUR') => instrumentInputSchema.parse({ ticker, symbol: ticker, currency });
const points = (...entries: [string, number][]) => entries.map(([t, c]) => ({ t, c }));

describe('valor histórico de cartera', () => {
  it('reconstruye compras, ventas, scrip y splits, incluyendo posiciones cerradas y excluyendo cobros', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-05',
      instruments: [instrument('AAA')], fx: {}, prices: { AAA: { currency: 'EUR', points: points(
        ['2026-01-01', 10], ['2026-01-02', 12], ['2026-01-03', 10], ['2026-01-04', 5], ['2026-01-05', 6]) } },
      operations: [
        op({ ticker: 'AAA', date: '2025-12-30', type: 'buy', shares: 10, amountEur: 100 }),
        op({ ticker: 'AAA', date: '2026-01-02', type: 'sell', shares: 2, amountEur: 24 }, 2),
        op({ ticker: 'AAA', date: '2026-01-03', type: 'scrip', shares: 2, amountEur: 0 }, 3),
        op({ ticker: 'AAA', date: '2026-01-03', type: 'dividend', amountEur: 20 }, 4),
        op({ ticker: 'AAA', date: '2026-01-04', type: 'split', splitRatio: 2, amountEur: 0 }, 5),
        op({ ticker: 'AAA', date: '2026-01-05', type: 'sell', shares: 20, amountEur: 120 }, 6),
        op({ ticker: 'AAA', date: '2026-01-06', type: 'buy', shares: 99, amountEur: 1000 }, 7),
      ],
    });
    expect(result.map((p) => p.valueEur)).toEqual([100, 96, 100, 100, 0]);
    expect(result.map((p) => p.fxEffectEur)).toEqual([0, 0, 0, 0, 0]);
  });

  it('separa precios y efecto divisa manteniendo el cambio del inicio incluso para nuevas compras', () => {
    const result = computePortfolioHistory({ from: '2026-01-02', to: '2026-01-03', instruments: [instrument('AAA', 'USD')],
      operations: [op({ ticker: 'AAA', date: '2026-01-03', type: 'buy', shares: 10, amountEur: 1000 })],
      prices: { AAA: { currency: 'USD', points: points(['2026-01-02', 100], ['2026-01-03', 120]) } },
      fx: { USD: points(['2026-01-02', 1.2], ['2026-01-03', 1.5]) },
    });
    expect(result[0]).toMatchObject({ valueEur: 0, constantFxEur: 0, fxEffectEur: 0 });
    expect(result[1]).toMatchObject({ valueEur: 800, constantFxEur: 1000, fxEffectEur: -200 });
  });

  it('usa el cierre anterior en festivos, nunca el siguiente ni un precio de hace más de 7 días', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-11', instruments: [instrument('AAA')], fx: {},
      prices: { AAA: { currency: 'EUR', points: points(['2026-01-02', 20]) } },
      operations: [op({ ticker: 'AAA', date: '2025-12-30', type: 'buy', shares: 2, amountEur: 10 })],
    });
    expect(result[0]!.valueEur).toBeNull();
    expect(result[2]!.valueEur).toBe(40);
    expect(result[8]!.valueEur).toBe(40);
    expect(result[9]!.valueEur).toBeNull();
  });

  it('no presenta una suma parcial cuando falta un símbolo o una divisa', () => {
    const args = { from: '2026-01-01', to: '2026-01-01', instruments: [instrument('AAA'), instrument('BBB', 'USD')],
      operations: ['AAA', 'BBB'].map((ticker, i) => op({ ticker, date: '2026-01-01', type: 'buy', shares: 1, amountEur: 10 }, i + 1)),
      prices: { AAA: { currency: 'EUR', points: points(['2026-01-01', 10]) } }, fx: {} };
    expect(computePortfolioHistory(args)[0]).toMatchObject({ valueEur: null, constantFxEur: null, missing: ['BBB'] });
    expect(computePortfolioHistory({ ...args, prices: { ...args.prices, BBB: { currency: 'USD', points: points(['2026-01-01', 20]) } } })[0])
      .toMatchObject({ valueEur: null, constantFxEur: null, missing: ['EUR/USD', 'EUR/USD al inicio'] });
  });

  it('mantiene la serie real aunque falte el cambio inicial y deja un hueco en la comparación', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-02', instruments: [instrument('AAA', 'USD')],
      operations: [op({ ticker: 'AAA', date: '2026-01-01', type: 'buy', shares: 10, amountEur: 100 })],
      prices: { AAA: { currency: 'USD', points: points(['2026-01-01', 10]) } }, fx: { USD: points(['2026-01-02', 2]) },
    });
    expect(result[1]).toMatchObject({ valueEur: 50, constantFxEur: null, fxEffectEur: null });
  });

  it('no multiplica por acciones nuevas el cierre anterior a un split sin cotización', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-02', instruments: [instrument('AAA')], fx: {},
      prices: { AAA: { currency: 'EUR', points: points(['2026-01-01', 100]) } }, operations: [
        op({ ticker: 'AAA', date: '2026-01-01', type: 'buy', shares: 2, amountEur: 200 }),
        op({ ticker: 'AAA', date: '2026-01-02', type: 'split', splitRatio: 4, amountEur: 0 }, 2),
      ] });
    expect(result.map((p) => p.valueEur)).toEqual([200, null]);
  });

  it('devuelve cero antes de invertir y al cerrar todo, y valida fechas reales y límites', () => {
    expect(computePortfolioHistory({ from: '2026-01-01', to: '2026-01-01', operations: [], instruments: [], prices: {}, fx: {} })[0]!.valueEur).toBe(0);
    for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-01-02', '2026-01-01'], ['1899-01-01', '2026-01-01'], ['1900-01-01', '2026-01-01']]) {
      expect(portfolioHistoryQuerySchema.safeParse({ from, to }).success).toBe(false);
    }
  });
});
