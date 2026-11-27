import { describe, expect, it } from 'vitest';
import { addMonths, computeLedger, sortOperations } from './ledger.ts';
import { operationInputSchema, type Operation, type OperationInput } from './schemas.ts';
import { brokerWithholdsInSpain, computeTaxYears, savingsBrackets, savingsTax, treatyRate } from './tax.ts';
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

  it('el «orden en el día» decide qué va antes entre operaciones de la misma fecha', () => {
    // Tenía 10 a 10 €; ese día vende 10 a 15 € (1.º) y recompra 10 a 12 € (2.º).
    const ops = [
      buy('2024-01-01', 'AAA', 10, 100),
      buy('2024-03-01', 'AAA', 10, 120, { dayOrder: 2 }),
      sell('2024-03-01', 'AAA', 10, 150, { dayOrder: 1 }),
    ];
    const t = computeLedger(ops).byTicker.get('AAA')!;
    expect(r2(t.sales[0]!.gainEur)).toBe(50); // vende el lote de 100 €, no el recién comprado
    expect(r2(t.costEur)).toBe(120);
    // Sin número, se aplica la regla por defecto: compra antes que venta (FIFO igual, el lote antiguo).
    expect(sortOperations(ops.map((o) => ({ ...o, dayOrder: null }))).map((o) => o.type)).toEqual(['buy', 'buy', 'sell']);
    expect(sortOperations(ops).map((o) => o.type)).toEqual(['buy', 'sell', 'buy']);
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

  it('la prima de emisión se reparte por acción y no por coste, y el exceso de cada lote es rendimiento', () => {
    const l = computeLedger([
      buy('2020-01-01', 'COL', 10, 10),
      buy('2020-06-01', 'COL', 10, 200),
      op({ date: '2021-01-01', ticker: 'COL', type: 'issue_premium', amountEur: 60 }),
    ]);
    const t = l.byTicker.get('COL')!;
    expect(t.openLots.map((x) => r2(x.taxCostEur))).toEqual([0, 170]);
    expect(l.income.map((i) => [r2(i.costReductionEur), r2(i.rcmEur)])).toEqual([[40, 20]]);
  });

  it('la prima de emisión resta lo mismo por acción a lotes de distinto coste', () => {
    const l = computeLedger([
      buy('2020-01-01', 'COL', 10, 100),
      buy('2020-06-01', 'COL', 10, 300),
      op({ date: '2021-01-01', ticker: 'COL', type: 'issue_premium', amountEur: 20 }),
    ]);
    const t = l.byTicker.get('COL')!;
    expect(t.openLots.map((x) => r2(x.taxCostEur))).toEqual([90, 290]);
    expect(l.income.map((i) => [r2(i.costReductionEur), r2(i.rcmEur)])).toEqual([[20, 0]]);
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

  it('una misma recompra posterior no aplaza dos pérdidas', () => {
    const l = computeLedger([
      buy('2025-12-01', 'X', 100, 2000),
      sell('2026-03-02', 'X', 50, 800),
      sell('2026-03-03', 'X', 50, 800),
      buy('2026-03-10', 'X', 50, 700),
    ]);
    const [a, b] = l.sales;
    expect(r2(a!.deferredLossEur)).toBe(200);
    expect(r2(b!.deferredLossEur)).toBe(0);
    expect(r2(b!.computableEur)).toBe(-200);
    expect(r2(l.byTicker.get('X')!.openLots[0]!.deferredLossEur)).toBe(200);
  });

  it('una misma compra anterior no aplaza dos pérdidas', () => {
    const l = computeLedger([
      buy('2025-12-01', 'Y', 100, 2000),
      buy('2026-02-20', 'Y', 50, 1000),
      sell('2026-03-02', 'Y', 50, 800),
      sell('2026-03-03', 'Y', 50, 800),
    ]);
    const [a, b] = l.sales;
    expect(r2(a!.deferredLossEur)).toBe(200);
    expect(r2(b!.deferredLossEur)).toBe(0);
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

  it('límites exactos: el mismo día dos meses antes y dos meses después sí cuentan; un día más, no', () => {
    const back = (buyDate: string) =>
      computeLedger([buy('2026-01-02', 'B', 100, 2000), buy(buyDate, 'B', 50, 900), sell('2026-06-12', 'B', 100, 1800)]).sales[0]!.deferredLossEur;
    expect(r2(back('2026-04-12'))).toBe(100);
    expect(back('2026-04-11')).toBe(0);
    const fwd = (buyDate: string) =>
      computeLedger([buy('2026-01-10', 'F', 100, 3000), sell('2026-06-12', 'F', 100, 2500), buy(buyDate, 'F', 100, 2400)]).sales[0]!.deferredLossEur;
    expect(r2(fwd('2026-08-12'))).toBe(500);
    expect(fwd('2026-08-13')).toBe(0);
  });

  describe('plazo según el tipo de valor (art. 33.5.f y g)', () => {
    const fundOf = (ticker: string) => [{ ticker, symbol: ticker, isin: null, kind: 'FUND' as const }];
    // Pérdida de 20 € el 1/3/2026 y recompra posterior de las mismas participaciones.
    const rebuy = (rebuyDate: string, instruments: Parameters<typeof computeLedger>[1]) =>
      computeLedger([buy('2026-01-10', 'F', 10, 100), sell('2026-03-01', 'F', 10, 80), buy(rebuyDate, 'F', 10, 80)], instruments).sales[0]!.deferredLossEur;

    it('en un fondo la recompra cuenta hasta un año después, con el límite exacto', () => {
      expect(r2(rebuy('2026-12-01', fundOf('F')))).toBe(20);
      expect(r2(rebuy('2027-03-01', fundOf('F')))).toBe(20);
      expect(rebuy('2027-03-02', fundOf('F'))).toBe(0);
    });

    it('en una acción o un ETF sigue siendo de dos meses', () => {
      expect(rebuy('2026-12-01', [])).toBe(0);
      expect(rebuy('2026-12-01', [{ ticker: 'F', symbol: 'F', isin: null, kind: 'ETF' }])).toBe(0);
      expect(r2(rebuy('2026-04-30', []))).toBe(20);
    });

    it('en un fondo la compra de hasta un año antes también aplaza la pérdida', () => {
      const back = (buyDate: string) =>
        computeLedger([buy('2025-02-01', 'F', 100, 2000), buy(buyDate, 'F', 50, 900), sell('2026-03-01', 'F', 100, 1800)], fundOf('F')).sales[0]!.deferredLossEur;
      expect(r2(back('2025-03-01'))).toBe(100);
      expect(back('2025-02-28')).toBe(0);
    });

    it('reconoce un fondo por su símbolo (ISIN) cuando no se indica el tipo', () => {
      expect(r2(rebuy('2026-12-01', [{ ticker: 'F', symbol: 'IE00B4L5Y983', isin: null }]))).toBe(20);
    });
  });

  it('addMonths ajusta al último día del mes y cruza de año', () => {
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonths('2027-12-31', 2)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', -2)).toBe('2025-11-30');
    expect(addMonths('2026-03-31', -2)).toBe('2026-01-31');
  });
});

describe('Renta', () => {
  it('escala del ahorro', () => {
    expect(savingsTax(6000)).toBeCloseTo(1140);
    expect(savingsTax(10_000)).toBeCloseTo(1140 + 840);
  });

  it('usa la escala de cada año: una base de 10.000 € da 2.030 € en 2015', () => {
    expect(savingsTax(10_000, 2015)).toBeCloseTo(2030);
    expect(savingsTax(10_000, 2007)).toBeCloseTo(1800);
    expect(savingsTax(10_000, 2010)).toBeCloseTo(1980);
    expect(savingsTax(10_000, 2013)).toBeCloseTo(2260);
    expect(savingsTax(10_000, 2018)).toBeCloseTo(1980);
    expect(savingsTax(250_000, 2021)).toBeCloseTo(57_880);
    expect(savingsTax(350_000, 2023)).toBeCloseTo(85_880);
    expect(savingsTax(350_000, 2025)).toBeCloseTo(86_880);
    // Sin año se usa la escala vigente, y un año futuro mantiene la última.
    expect(savingsTax(350_000)).toBeCloseTo(86_880);
    expect(savingsTax(350_000, 2031)).toBeCloseTo(86_880);
    expect(savingsBrackets(2015)).toHaveLength(3);
  });

  it('la cuota estimada de cada informe anual usa la escala de su año', () => {
    const l = computeLedger([buy('2014-01-01', 'H', 10, 1000), sell('2015-06-01', 'H', 10, 11_000)]);
    const y = computeTaxYears(l, 2015).find((x) => x.year === 2015)!;
    expect(r2(y.taxBase)).toBe(10_000);
    expect(r2(y.taxEstimate)).toBe(2030);
    const l2 = computeLedger([buy('2024-01-01', 'H', 10, 1000), sell('2025-06-01', 'H', 10, 11_000)]);
    expect(r2(computeTaxYears(l2, 2025).find((x) => x.year === 2025)!.taxEstimate)).toBe(1980);
  });

  it('en 2013 y 2014 lo vendido con un año o menos va a la base general, no a la del ahorro', () => {
    const l = computeLedger([buy('2012-01-01', 'S', 10, 1000), buy('2013-03-01', 'S', 10, 1000), sell('2013-09-01', 'S', 15, 3000)]);
    const y = computeTaxYears(l, 2013).find((x) => x.year === 2013)!;
    // 10 acciones de 2012: +1.000 € al ahorro. 5 de 2013 (menos de un año): +500 € a la base general.
    expect(r2(y.gpBalance)).toBe(1000);
    expect(r2(y.shortTermBalance)).toBe(500);
    expect(r2(y.gpBase)).toBe(1000);
    expect(r2(y.taxEstimate)).toBe(210);
    // La misma venta en 2015 ya iba entera a la base del ahorro.
    const l15 = computeLedger([buy('2014-01-01', 'S', 10, 1000), buy('2015-03-01', 'S', 10, 1000), sell('2015-09-01', 'S', 15, 3000)]);
    const y15 = computeTaxYears(l15, 2015).find((x) => x.year === 2015)!;
    expect(y15.shortTermBalance).toBe(0);
    expect(r2(y15.gpBase)).toBe(1500);
  });

  it('un año de antigüedad exacto sigue siendo corto; un día más, largo', () => {
    const at = (sellDate: string) => computeTaxYears(computeLedger([buy('2013-09-01', 'S', 10, 1000), sell(sellDate, 'S', 10, 1500)]), 2014).find((x) => x.year === 2014)!;
    expect(r2(at('2014-09-01').shortTermBalance)).toBe(500);
    expect(at('2014-09-01').gpBase).toBe(0);
    expect(at('2014-09-02').shortTermBalance).toBe(0);
    expect(r2(at('2014-09-02').gpBase)).toBe(500);
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

  it('arrastra cuatro años el saldo negativo de RCM y lo compensa con RCM posterior', () => {
    const l = computeLedger([
      buy('2022-01-01', 'R', 100, 1000),
      op({ date: '2022-06-01', ticker: 'R', type: 'dividend', amountEur: 10, fees: 60 }),
      op({ date: '2023-06-01', ticker: 'R', type: 'dividend', amountEur: 100 }),
    ]);
    const years = computeTaxYears(l, 2023);
    const y22 = years.find((y) => y.year === 2022)!;
    expect(y22.carriedPending).toEqual([{ year: 2022, amount: 50, kind: 'rcm' }]);
    const y23 = years.find((y) => y.year === 2023)!;
    expect(y23.carriedUsed).toEqual([{ year: 2022, amount: 50, kind: 'rcm' }]);
    expect(r2(y23.rcmBase)).toBe(50);
    expect(y23.carriedPending).toEqual([]);
  });

  it('estima la retención del 19 % de los dividendos importados desde 2026 si el bróker es español', () => {
    const l = computeLedger([
      buy('2025-01-01', 'TEF', 1000, 4000),
      op({ date: '2025-06-01', ticker: 'TEF', type: 'dividend', amountEur: 150, source: 'excel', broker: 'ING' }),
      op({ date: '2026-06-18', ticker: 'TEF', type: 'dividend', amountEur: 150, source: 'excel', broker: 'ING' }),
    ]);
    const years = computeTaxYears(l, 2026);
    expect(years.find((y) => y.year === 2025)!.withholdingEs).toBe(0);
    const y26 = years.find((y) => y.year === 2026)!;
    expect(y26.withholdingEsEstimated).toBe(28.5);
    expect(y26.rcmLines[0]!.estimated).toBe(true);
  });

  it('no estima retención si el bróker es extranjero o no se sabe cuál es', () => {
    for (const broker of ['Interactive Brokers', 'Trade Republic', 'Degiro', undefined]) {
      const l = computeLedger([
        buy('2025-01-01', 'TEF', 1000, 4000),
        op({ date: '2026-06-18', ticker: 'TEF', type: 'dividend', amountEur: 150, source: 'excel', broker }),
      ]);
      const y26 = computeTaxYears(l, 2026).find((y) => y.year === 2026)!;
      expect(y26.withholdingEs, String(broker)).toBe(0);
      expect(y26.withholdingEsEstimated).toBe(0);
      expect(y26.rcmLines[0]!.estimated).toBe(false);
    }
  });

  it('una retención apuntada manda sobre la estimación, también con un bróker español', () => {
    const l = computeLedger([
      buy('2025-01-01', 'TEF', 1000, 4000),
      op({ date: '2026-06-18', ticker: 'TEF', type: 'dividend', amountEur: 150, source: 'excel', broker: 'ING', withholdingEs: 20 }),
    ]);
    const y26 = computeTaxYears(l, 2026).find((y) => y.year === 2026)!;
    expect(y26.withholdingEs).toBe(20);
    expect(y26.withholdingEsEstimated).toBe(0);
  });

  it('reconoce los depositarios españoles por su nombre, con tildes, mayúsculas y sufijos', () => {
    for (const b of ['ING', 'ing direct', 'MyInvestor', 'Renta 4 Banco', 'Bankinter', 'Self Bank', 'Banco Santander', 'BBVA', 'Openbank'])
      expect(brokerWithholdsInSpain(b), b).toBe(true);
    for (const b of ['Interactive Brokers', 'Degiro', 'Trade Republic', 'Scalable', 'Revolut', 'Ping', '', null, undefined])
      expect(brokerWithholdsInSpain(b), String(b)).toBe(false);
  });

  it('descuenta de la cuota la retención de la venta de derechos', () => {
    const l = computeLedger([
      buy('2022-01-01', 'REP', 10, 100),
      op({ date: '2022-06-01', ticker: 'REP', type: 'rights_sale', amountEur: 100, withholdingEs: 19 }),
    ]);
    const y = computeTaxYears(l, 2022).find((x) => x.year === 2022)!;
    expect(r2(y.gains)).toBe(100);
    expect(r2(y.taxEstimate)).toBe(19);
    expect(y.withholdingEs).toBe(19);
    expect(r2(y.balanceEstimate)).toBe(0);
  });

  it('no estima retención en la venta de derechos importada sin retención', () => {
    const l = computeLedger([
      buy('2025-01-01', 'REP', 10, 100),
      op({ date: '2026-06-01', ticker: 'REP', type: 'rights_sale', amountEur: 100, source: 'excel' }),
    ]);
    const y = computeTaxYears(l, 2026).find((x) => x.year === 2026)!;
    expect(y.withholdingEs).toBe(0);
    expect(y.withholdingEsEstimated).toBe(0);
  });

  it('la doble imposición solo deduce lo retenido hasta el tipo del convenio', () => {
    // Alemania retiene el 26,375 % y el convenio permite el 15 %: se deducen 150 €, no 190 €.
    const l = computeLedger(
      [
        buy('2022-01-01', 'SAP', 10, 1000),
        op({ date: '2022-06-01', ticker: 'SAP', type: 'dividend', amountEur: 1000, withholdingForeign: 263.75 }),
      ],
      [{ ticker: 'SAP', symbol: null, isin: 'DE0007164600' }],
    );
    const y = computeTaxYears(l, 2022).find((x) => x.year === 2022)!;
    expect(r2(y.taxEstimate)).toBe(190);
    expect(r2(y.foreignDeduction)).toBe(150);
    expect(r2(y.balanceEstimate)).toBe(40);
  });

  it('la deducción por doble imposición no deja la cuota por debajo de cero', () => {
    // Dividendo de EE. UU. de 1.000 € (150 € retenidos) y 250 € de pérdidas: la cuota es 142,50 €.
    const l = computeLedger(
      [
        buy('2022-01-01', 'KO', 10, 1000),
        op({ date: '2022-06-01', ticker: 'KO', type: 'dividend', amountEur: 1000, withholdingForeign: 150 }),
        buy('2022-01-01', 'XYZ', 10, 1000),
        sell('2022-12-01', 'XYZ', 10, 750),
      ],
      [{ ticker: 'KO', symbol: null, isin: 'US1912161007' }],
    );
    const y = computeTaxYears(l, 2022).find((x) => x.year === 2022)!;
    expect(r2(y.taxEstimate)).toBe(142.5);
    expect(r2(y.foreignDeduction)).toBe(142.5);
    expect(r2(y.balanceEstimate)).toBe(0);
  });

  it('sin ISIN se aplica el tipo general del convenio', () => {
    const l = computeLedger([
      buy('2022-01-01', 'SAP', 10, 1000),
      op({ date: '2022-06-01', ticker: 'SAP', type: 'dividend', amountEur: 1000, withholdingForeign: 263.75 }),
    ]);
    const y = computeTaxYears(l, 2022).find((x) => x.year === 2022)!;
    expect(r2(y.foreignDeduction)).toBe(150);
  });

  it('el tipo del convenio sale del prefijo del ISIN', () => {
    expect(treatyRate('US0378331005')).toBe(0.15);
    expect(treatyRate('CH0012005267')).toBe(0.15);
    expect(treatyRate('NL0010273215')).toBe(0.15);
    expect(treatyRate('GB0002634946')).toBe(0);
    expect(treatyRate('IE00B4L5Y983')).toBe(0);
    expect(treatyRate('fr0000120271')).toBe(0.15);
    expect(treatyRate('ZZ0000000000')).toBe(0.15);
    expect(treatyRate(null)).toBe(0.15);
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
