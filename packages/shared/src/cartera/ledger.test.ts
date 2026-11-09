import { describe, expect, it } from 'vitest';
import { addMonths, computeLedger } from './ledger.ts';
import { operationInputSchema, type Operation, type OperationInput } from './schemas.ts';
import { computeTaxYears, savingsTax } from './tax.ts';
import { valueCartera, xirr } from './view.ts';

let nextId = 1;
const op = (o: OperationInput): Operation => ({ id: nextId++, ...operationInputSchema.parse(o) });
const buy = (date: string, ticker: string, shares: number, amountEur: number, extra: Partial<OperationInput> = {}) =>
  op({ date, ticker, type: 'buy', shares, amountEur, ...extra });
const sell = (date: string, ticker: string, shares: number, amountEur: number, extra: Partial<OperationInput> = {}) =>
  op({ date, ticker, type: 'sell', shares, amountEur, ...extra });
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('addMonths', () => {
  it('suma y resta meses ajustando al último día', () => {
    expect(addMonths('2026-06-12', 2)).toBe('2026-08-12');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
  });
});

describe('FIFO', () => {
  it('vende primero las acciones más antiguas y calcula el resultado', () => {
    const l = computeLedger([
      buy('2020-01-10', 'AAA', 100, 1000),
      buy('2021-01-10', 'AAA', 100, 2000),
      sell('2022-05-01', 'AAA', 150, 3300),
    ]);
    const t = l.byTicker.get('AAA')!;
    const sale = t.sales[0]!;
    expect(sale.matches.map((m) => [m.shares, r2(m.costEur)])).toEqual([
      [100, 1000],
      [50, 1000],
    ]);
    expect(r2(sale.gainEur)).toBe(1300);
    expect(t.shares).toBe(50);
    expect(r2(t.costEur)).toBe(1000);
    expect(t.closedLots).toHaveLength(1);
    expect(l.issues).toEqual([]);
  });

  it('avisa si se vende más de lo que hay', () => {
    const l = computeLedger([buy('2020-01-10', 'AAA', 10, 100), sell('2020-02-10', 'AAA', 20, 300)]);
    expect(l.issues).toHaveLength(1);
    expect(l.issues[0]!.message).toMatch(/solo hay 10/);
  });

  it('el mismo día procesa la compra antes que la venta', () => {
    const s = sell('2024-03-01', 'AAA', 10, 120);
    const b = buy('2024-03-01', 'AAA', 10, 100);
    expect(computeLedger([s, b]).issues).toEqual([]);
  });

  it('el FIFO es global aunque haya varios brókers', () => {
    const l = computeLedger([
      buy('2020-01-01', 'CASH', 100, 50, { broker: 'ING' }),
      buy('2021-01-01', 'CASH', 100, 70, { broker: 'MyInvestor' }),
      sell('2022-01-01', 'CASH', 100, 80, { broker: 'MyInvestor' }),
    ]);
    const t = l.byTicker.get('CASH')!;
    expect(t.sales[0]!.matches[0]!.lotId).toBe(t.closedLots[0]!.id);
    expect(r2(t.sales[0]!.gainEur)).toBe(30);
    expect(t.sharesByBroker).toEqual({ ING: 100 });
  });
});

describe('scrip, splits, primas y derechos', () => {
  it('reparte las acciones liberadas entre los lotes en proporción y conserva la antigüedad', () => {
    const l = computeLedger([
      buy('2020-01-01', 'TEF', 100, 1000),
      buy('2021-01-01', 'TEF', 300, 1200),
      op({ date: '2021-06-01', ticker: 'TEF', type: 'scrip', shares: 20, amountEur: 0 }),
    ]);
    const lots = l.byTicker.get('TEF')!.openLots;
    expect(lots.map((x) => x.shares)).toEqual([105, 315]);
    expect(lots.map((x) => x.date)).toEqual(['2020-01-01', '2021-01-01']);
    expect(r2(l.byTicker.get('TEF')!.costEur)).toBe(2200);
  });

  it('el scrip con lote (columna «Lote» del Excel) va entero a esa compra', () => {
    const l = computeLedger([
      op({ date: '2020-01-01', ticker: 'TEF', type: 'buy', shares: 100, amountEur: 1000, sourceRef: 1 }),
      op({ date: '2021-01-01', ticker: 'TEF', type: 'buy', shares: 300, amountEur: 1200, sourceRef: 5 }),
      op({ date: '2021-01-01', ticker: 'TEF', type: 'scrip', shares: 20, amountEur: 0, lotRef: 5 }),
      sell('2022-01-01', 'TEF', 100, 900),
    ]);
    const t = l.byTicker.get('TEF')!;
    // Se vende el primer lote entero (sin scrip): coste 1000.
    expect(r2(t.sales[0]!.costEur)).toBe(1000);
    expect(t.openLots.map((x) => x.shares)).toEqual([320]);
  });

  it('aplica los splits a los lotes abiertos', () => {
    const l = computeLedger([
      buy('2020-01-01', 'X', 10, 1000),
      op({ date: '2021-01-01', ticker: 'X', type: 'split', splitRatio: 4, amountEur: 0 }),
      sell('2022-01-01', 'X', 20, 600),
    ]);
    const t = l.byTicker.get('X')!;
    expect(t.shares).toBe(20);
    expect(r2(t.sales[0]!.gainEur)).toBe(100);
  });

  it('la prima de emisión reduce el coste fiscal y el exceso es rendimiento', () => {
    const l = computeLedger([
      buy('2020-01-01', 'COL', 10, 100),
      op({ date: '2021-01-01', ticker: 'COL', type: 'issue_premium', amountEur: 30 }),
      op({ date: '2022-01-01', ticker: 'COL', type: 'issue_premium', amountEur: 90 }),
    ]);
    const t = l.byTicker.get('COL')!;
    expect(r2(t.taxCostEur)).toBe(0);
    expect(r2(t.costEur)).toBe(100);
    expect(l.income.map((i) => [r2(i.costReductionEur), r2(i.rcmEur)])).toEqual([
      [30, 0],
      [70, 20],
    ]);
    expect(r2(t.otherIncomeEur)).toBe(120);
  });

  it('la venta de derechos es ganancia desde 2017 y reducía el coste antes', () => {
    const l = computeLedger([
      buy('2015-01-01', 'REP', 10, 100),
      op({ date: '2016-06-01', ticker: 'REP', type: 'rights_sale', amountEur: 5 }),
      op({ date: '2021-01-07', ticker: 'REP', type: 'rights_sale', amountEur: 0, fees: 6.24 }),
    ]);
    const [old, recent] = l.income;
    expect(r2(old!.costReductionEur)).toBe(5);
    expect(r2(recent!.gainEur)).toBe(-6.24);
    expect(r2(l.byTicker.get('REP')!.taxCostEur)).toBe(95);
  });
});

describe('regla de los dos meses', () => {
  it('aplaza la pérdida si se recompra en los dos meses siguientes y la integra al vender', () => {
    const l = computeLedger([
      buy('2026-01-10', 'CLNX', 100, 3000),
      sell('2026-06-12', 'CLNX', 100, 2500),
      buy('2026-07-08', 'CLNX', 100, 2400),
      sell('2026-10-30', 'CLNX', 100, 2600),
    ]);
    const [first, second] = l.byTicker.get('CLNX')!.sales;
    expect(r2(first!.taxGainEur)).toBe(-500);
    expect(r2(first!.deferredLossEur)).toBe(500);
    expect(r2(first!.computableEur)).toBe(0);
    expect(r2(second!.releasedLossEur)).toBe(500);
    expect(r2(second!.computableEur)).toBe(-300);
    // El resultado económico no cambia.
    expect(r2(first!.gainEur + second!.gainEur)).toBe(-300);
  });

  it('cuenta las compras de los dos meses anteriores que siguen en cartera (solo en proporción)', () => {
    const l = computeLedger([
      buy('2026-01-02', 'FDR', 100, 2000),
      buy('2026-05-13', 'FDR', 50, 900),
      sell('2026-06-11', 'FDR', 100, 1800),
    ]);
    const sale = l.sales[0]!;
    expect(r2(sale.taxGainEur)).toBe(-200);
    expect(r2(sale.deferredLossEur)).toBe(100);
    expect(r2(sale.computableEur)).toBe(-100);
  });

  it('no aplica si la recompra es más tarde de dos meses', () => {
    const l = computeLedger([
      buy('2026-01-10', 'X', 10, 100),
      sell('2026-03-01', 'X', 10, 80),
      buy('2026-05-02', 'X', 10, 80),
    ]);
    expect(l.sales[0]!.deferredLossEur).toBe(0);
  });
});

describe('Renta', () => {
  it('escala del ahorro', () => {
    expect(savingsTax(6000)).toBeCloseTo(1140);
    expect(savingsTax(10_000)).toBeCloseTo(1140 + 840);
  });

  it('compensa con el 25 % de los dividendos y arrastra el resto cuatro años', () => {
    const l = computeLedger([
      buy('2022-01-01', 'A', 100, 10_000),
      op({ date: '2022-06-01', ticker: 'A', type: 'dividend', amountEur: 400, withholdingEs: 76 }),
      sell('2022-12-01', 'A', 100, 9_000),
      buy('2023-01-01', 'B', 100, 1000),
      sell('2025-01-01', 'B', 100, 2500),
    ]);
    const years = computeTaxYears(l, 2025);
    const y22 = years.find((y) => y.year === 2022)!;
    expect(r2(y22.crossCompensation)).toBe(100);
    expect(r2(y22.rcmBase)).toBe(300);
    expect(y22.carriedPending).toEqual([{ year: 2022, amount: 900 }]);
    expect(y22.withholdingEs).toBe(76);
    const y25 = years.find((y) => y.year === 2025)!;
    expect(y25.carriedUsed).toEqual([{ year: 2022, amount: 900 }]);
    expect(r2(y25.gpBase)).toBe(600);
  });

  it('estima la retención del 19 % de los dividendos importados desde 2026', () => {
    const l = computeLedger([
      buy('2025-01-01', 'TEF', 1000, 4000),
      op({ date: '2025-06-01', ticker: 'TEF', type: 'dividend', amountEur: 150, source: 'excel' }),
      op({ date: '2026-06-18', ticker: 'TEF', type: 'dividend', amountEur: 150, source: 'excel' }),
    ]);
    const years = computeTaxYears(l, 2026);
    expect(years.find((y) => y.year === 2025)!.withholdingEs).toBe(0);
    const y26 = years.find((y) => y.year === 2026)!;
    expect(y26.withholdingEsEstimated).toBe(28.5);
    expect(y26.rcmLines[0]!.estimated).toBe(true);
  });
});

describe('valoración', () => {
  it('suma latente, realizada y cobros, y el total cuadra con la caja', () => {
    const l = computeLedger([
      buy('2024-01-01', 'IBM', 10, 1800, { fxRate: 1.1, price: 195 }),
      buy('2024-01-01', 'TEF', 100, 400),
      sell('2025-01-01', 'TEF', 100, 450),
      op({ date: '2024-06-01', ticker: 'TEF', type: 'dividend', amountEur: 30 }),
    ]);
    const v = valueCartera({
      ledger: l,
      instruments: [
        { ticker: 'IBM', symbol: 'IBM', name: 'IBM', sector: 'Tecnología', currency: 'USD', isin: null, notes: null },
        { ticker: 'TEF', symbol: 'TEF.MC', name: 'Telefónica', sector: null, currency: 'EUR', isin: null, notes: null },
      ],
      quotes: {
        IBM: { symbol: 'IBM', name: 'IBM', currency: 'USD', price: 220, changePct: 0.01, previousClose: 217.8, low52: null, high52: null, quoteType: 'EQUITY', exchange: null, marketState: null, fetchedAt: '', stale: false },
      },
      fx: { EUR: 1, USD: 1.1 },
      today: '2026-01-01',
    });
    expect(v.open).toHaveLength(1);
    expect(v.closed.map((c) => c.ticker)).toEqual(['TEF']);
    expect(r2(v.summary.valueEur)).toBe(2000);
    expect(r2(v.summary.unrealizedEur)).toBe(200);
    expect(r2(v.summary.realizedEur)).toBe(50);
    expect(r2(v.summary.incomeEur)).toBe(30);
    // Total = caja recibida + valor hoy − caja invertida.
    expect(r2(v.summary.totalEur)).toBe(r2(450 + 30 + 2000 - 1800 - 400));
    expect(v.summary.xirr).toBeGreaterThan(0);
    expect(v.bySector.map((x) => [x.sector, r2(x.valueEur)])).toEqual([['Tecnología', 2000]]);
  });

  it('TIR de un caso sencillo', () => {
    expect(xirr([{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: 110 }])).toBeCloseTo(0.1, 2);
  });
});
