import { describe, expect, it } from 'vitest';
import { computeLedger } from './ledger.ts';
import { computePortfolioHistory } from './history.ts';
import { instrumentInputSchema, operationInputSchema, type Operation, type OperationInput } from './schemas.ts';
import { valueCartera } from './view.ts';
import { detectImportColumns, discoverImportInstruments, importOptionsSchema, previewImport } from './import.ts';

const ops = (inputs: OperationInput[]): Operation[] => inputs.map((input, index) => ({ id: index + 1, ...operationInputSchema.parse(input) }));
// El diferimiento solo vale entre fondos de inversión: se declaran como tales.
const fund = (ticker: string) => ({ ticker, symbol: ticker, isin: null, kind: 'FUND' as const });
const ledgerOf = (operations: Operation[]) => computeLedger(operations, [fund('A'), fund('B')]);
const movements: OperationInput[] = [
  { date: '2020-01-01', ticker: 'A', type: 'buy', shares: 10, amountEur: 100 },
  { date: '2021-01-01', ticker: 'A', type: 'buy', shares: 10, amountEur: 200 },
  { date: '2022-01-01', ticker: 'B', type: 'buy', shares: 5, amountEur: 150 },
  { date: '2024-01-01', ticker: 'A', type: 'transfer_out', shares: 15, amountEur: 450, transferRef: 'A-B' },
  { date: '2024-01-02', ticker: 'B', type: 'transfer_in', shares: 9, amountEur: 450, transferRef: 'A-B' },
];

describe('traspasos de fondos con diferimiento', () => {
  it('traslada coste y antigüedad por FIFO sin venta, ingresos ni aportaciones nuevas', () => {
    const ledger = ledgerOf(ops(movements));
    expect(ledger.issues).toEqual([]);
    expect(ledger.sales).toEqual([]);
    expect(ledger.income).toEqual([]);
    expect(ledger.cashFlows.map(f => f.amount)).toEqual([-100, -200, -150]);
    expect(ledger.byTicker.get('A')).toMatchObject({ shares: 5, costEur: 100, taxCostEur: 100 });
    expect(ledger.byTicker.get('B')!.openLots.map(l => [l.date, l.shares, l.costEur])).toEqual([
      ['2020-01-01', 6, 100], ['2021-01-01', 3, 100], ['2022-01-01', 5, 150],
    ]);
    const sold = ledgerOf(ops([...movements, { date: '2024-03-01', ticker: 'B', type: 'sell', shares: 7, amountEur: 350 }]));
    expect(sold.sales[0]!.taxCostEur).toBeCloseTo(100 + 100 / 3);
    expect(sold.sales[0]!.matches.map(m => m.buyDate)).toEqual(['2020-01-01', '2021-01-01']);
  });

  it('conserva el dinero en tránsito y la TIR solo usa flujos externos', () => {
    const ledger = ledgerOf(ops(movements.slice(0, 4)));
    expect(ledger).toMatchObject({ inTransitEur: 450, inTransitCostEur: 200 });
    const full = ops([
      { date: '2023-01-01', ticker: 'A', type: 'buy', shares: 10, amountEur: 100 },
      { date: '2024-01-01', ticker: 'A', type: 'transfer_out', shares: 10, amountEur: 110, transferRef: 'total' },
    ]);
    const valuation = valueCartera({ ledger: ledgerOf(full), instruments: [], quotes: {}, fx: {}, today: '2024-01-01' });
    expect(valuation.summary).toMatchObject({ valueEur: 110, costEur: 100, totalEur: 10, boughtEur: 100 });
    expect(valuation.summary.xirr).toBeCloseTo(0.1, 6);
    expect(valuation.open).toHaveLength(0);
  });

  it('rechaza referencias ausentes, duplicadas, cantidades imposibles y parejas incompatibles', () => {
    expect(operationInputSchema.safeParse({ ...movements[3], transferRef: null }).success).toBe(false);
    const valid = ops(movements);
    expect(ledgerOf([valid[4]!]).issues).toHaveLength(1);
    expect(ledgerOf([...valid, { ...valid[4]!, id: 20 }]).issues).toHaveLength(1);
    expect(ledgerOf(ops([...movements.slice(0, 4), { ...movements[4]!, amountEur: 451 }])).issues).toHaveLength(1);
    expect(ledgerOf(ops([...movements.slice(0, 3), { ...movements[3]!, shares: 21 }])).issues).toHaveLength(1);
    expect(ledgerOf(ops([...movements.slice(0, 4), { ...movements[4]!, ticker: 'A' }])).issues).toHaveLength(1);
    expect(ledgerOf(ops([...movements, { ...movements[3]!, date: '2025-01-01', shares: 1 }])).issues).toHaveLength(1);
  });

  it('no admite el traspaso sin tributar de ETF, acciones ni entre un fondo y un ETF', () => {
    const kinds = (a: 'ETF' | 'EQUITY' | 'FUND', b: 'ETF' | 'EQUITY' | 'FUND') => computeLedger(ops(movements), [
      { ticker: 'A', symbol: 'A', isin: null, kind: a }, { ticker: 'B', symbol: 'B', isin: null, kind: b }]);
    expect(kinds('FUND', 'FUND').issues).toEqual([]);
    for (const [a, b] of [['ETF', 'ETF'], ['EQUITY', 'EQUITY'], ['FUND', 'ETF'], ['ETF', 'FUND'], ['FUND', 'EQUITY']] as const) {
      const issues = kinds(a, b).issues;
      expect(issues.length, `${a} → ${b}`).toBeGreaterThan(0);
      expect(issues[0]!.message).toMatch(/fondos de inversión/);
    }
    // La salida rechazada no mueve lotes: el ETF sigue con sus participaciones.
    expect(kinds('ETF', 'FUND').byTicker.get('A')!.shares).toBe(20);
  });

  it('no crea caídas o aportaciones ficticias entre la salida y la entrada en el histórico', () => {
    const operations = ops([
      { date: '2024-01-01', ticker: 'A', type: 'buy', shares: 10, amountEur: 100 },
      { date: '2024-01-02', ticker: 'A', type: 'transfer_out', shares: 10, amountEur: 120, transferRef: 'hist' },
      { date: '2024-01-03', ticker: 'B', type: 'transfer_in', shares: 6, amountEur: 120, transferRef: 'hist' },
    ]);
    const result = computePortfolioHistory({ operations, from: '2024-01-01', to: '2024-01-03', fx: {},
      instruments: ['A', 'B'].map(ticker => instrumentInputSchema.parse({ ticker, symbol: ticker })),
      prices: { A: { currency: 'EUR', points: [{ t: '2024-01-01', c: 12 }] }, B: { currency: 'EUR', points: [{ t: '2024-01-03', c: 20 }] } },
    });
    expect(result.map(p => p.valueEur)).toEqual([120, 120, 120]);
    expect(result.map(p => p.resultEur)).toEqual([20, 20, 20]);
    expect(result[2]).toMatchObject({ purchasesEur: 100, salesEur: 0, incomeEur: 0 });
  });

  it('reconoce ambos apuntes y su referencia al importar el extracto', () => {
    const header = ['Fecha', 'Ticker', 'Tipo', 'Participaciones', 'Precio', 'Importe', 'Referencia del traspaso'];
    const rows = [header, ['2024-01-01', 'A', 'Traspaso de salida', 10, 12, 120, 'par'], ['2024-01-02', 'B', 'Traspaso entrada', 6, 20, 120, 'par']];
    const options = importOptionsSchema.parse({ columns: detectImportColumns(header), amountCurrency: 'EUR' });
    const parsed = previewImport(rows, 0, options, discoverImportInstruments(rows.slice(1), options, []));
    expect(parsed.map(p => p.errors)).toEqual([[], []]);
    expect(parsed.map(p => [p.operation?.type, p.operation?.transferRef, p.operation?.amountEur])).toEqual([
      ['transfer_out', 'par', 120], ['transfer_in', 'par', 120],
    ]);
  });
});
