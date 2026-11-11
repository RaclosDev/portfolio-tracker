import { describe, expect, it } from 'vitest';
import { computePortfolioHistory, portfolioHistoryQuerySchema } from './history.ts';
import { computeLedger } from './ledger.ts';
import { valueCartera } from './view.ts';
import { instrumentInputSchema, operationInputSchema, type Operation, type OperationInput } from './schemas.ts';

const op = (input: OperationInput, id = 1): Operation => ({ id, ...operationInputSchema.parse(input) });
const instrument = (ticker: string, currency = 'EUR') => instrumentInputSchema.parse({ ticker, symbol: ticker, currency });
const points = (...entries: [string, number][]) => entries.map(([t, c]) => ({ t, c }));

describe('valor histórico de cartera', () => {
  it('conserva la ganancia al pasar de 100.000 a 40.000 euros tras vender por 70.000', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-02',
      instruments: [instrument('AAA')], fx: {},
      prices: { AAA: { currency: 'EUR', points: points(['2025-12-31', 100], ['2026-01-01', 100], ['2026-01-02', 100]) } },
      operations: [
        op({ ticker: 'AAA', date: '2025-12-31', type: 'buy', shares: 1000, amountEur: 90000 }),
        op({ ticker: 'AAA', date: '2026-01-01', type: 'sell', shares: 600, amountEur: 70000 }, 2),
      ] });
    expect(result[0]).toMatchObject({ startingValueEur: 100000, valueEur: 40000, salesEur: 70000, resultEur: 10000 });
    expect(result[1]!.resultEur).toBe(10000);
  });

  it('neutraliza compras y reinversión e incluye cobros económicos sin duplicar comisiones', () => {
    const operations = [
      op({ ticker: 'AAA', date: '2026-01-01', type: 'buy', shares: 10, amountEur: 102, fees: 2 }),
      op({ ticker: 'AAA', date: '2026-01-02', type: 'dividend', amountEur: 25, fees: 2, fxRate: 2, withholdingForeign: 4, withholdingEs: 3 }, 2),
      op({ ticker: 'AAA', date: '2026-01-02', type: 'buy', shares: 2, amountEur: 20 }, 3),
      op({ ticker: 'AAA', date: '2026-01-03', type: 'sell', shares: 12, amountEur: 130, fees: 2 }, 4),
    ];
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-04', operations,
      instruments: [instrument('AAA')], fx: {}, prices: { AAA: { currency: 'EUR', points: points(['2026-01-01', 10]) } } });
    expect(result.map((p) => p.resultEur)).toEqual([-2, 18, 28, 28]);
    expect(result[3]).toMatchObject({ valueEur: 0, purchasesEur: 122, salesEur: 130, incomeEur: 20 });
    expect(valueCartera({ ledger: computeLedger(operations), instruments: [], quotes: {}, fx: {}, today: '2026-01-04' }).summary.totalEur).toBe(28);
  });

  it('no calcula ganancias con una base desconocida ni usa un cambio de divisa futuro para ella', () => {
    const args = { from: '2026-01-02', to: '2026-01-02', instruments: [instrument('AAA', 'USD')],
      operations: [op({ ticker: 'AAA', date: '2026-01-01', type: 'buy', shares: 10, amountEur: 100 })],
      prices: { AAA: { currency: 'USD', points: points(['2026-01-01', 10]) } },
      fx: { USD: points(['2026-01-02', 2]) } };
    expect(computePortfolioHistory(args)[0]).toMatchObject({ valueEur: 50, startingValueEur: null, resultEur: null });
    expect(computePortfolioHistory({ ...args, fx: { USD: points(['2026-01-01', 1], ['2026-01-02', 2]) } })[0])
      .toMatchObject({ valueEur: 50, startingValueEur: 100, resultEur: -50 });
  });

  it('recupera el resultado tras un hueco intermedio y no cuenta flujos fuera del periodo', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-10', instruments: [instrument('AAA')], fx: {},
      prices: { AAA: { currency: 'EUR', points: points(['2025-12-31', 10], ['2026-01-10', 12]) } },
      operations: [op({ ticker: 'AAA', date: '2025-12-30', type: 'buy', shares: 10, amountEur: 90 }),
        op({ ticker: 'AAA', date: '2025-12-31', type: 'dividend', amountEur: 20 }, 2),
        op({ ticker: 'AAA', date: '2026-01-11', type: 'dividend', amountEur: 30 }, 3)] });
    expect(result[7]!.resultEur).toBeNull();
    expect(result[9]).toMatchObject({ resultEur: 20, purchasesEur: 0, salesEur: 0, incomeEur: 0 });
  });

  it('reconstruye compras, ventas, scrip y splits, incluyendo posiciones cerradas y excluyendo cobros', () => {
    const result = computePortfolioHistory({ from: '2026-01-01', to: '2026-01-05',
      instruments: [instrument('AAA')], fx: {}, prices: { AAA: { currency: 'EUR', points: points(
        ['2025-12-31', 10], ['2026-01-01', 10], ['2026-01-02', 12], ['2026-01-03', 10], ['2026-01-04', 5], ['2026-01-05', 6]) } },
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
    expect(result.map((p) => p.resultEur)).toEqual([0, 20, 44, 44, 64]);
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
