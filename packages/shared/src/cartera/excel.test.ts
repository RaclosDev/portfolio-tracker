import { describe, expect, it } from 'vitest';
import { cellDate, cellNumber, parseRegistro, parseResumenTotals, type Cell } from './excel.ts';
import { computeLedger } from './ledger.ts';
import { operationInputSchema } from './schemas.ts';

const HEADER: Cell[] = ['nº', 'Fecha', 'Acción', 'Ticker', 'Tipo', 'Cantidad', 'Precio', 'Div, G e I', 'T/C', 'Importe total', 'Relac.split', 'F split', 'Lote'];
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('celdas', () => {
  it('números y fechas en varios formatos', () => {
    expect(cellNumber('1.234,56')).toBe(1234.56);
    expect(cellNumber('12,5')).toBe(12.5);
    expect(cellNumber('#VALUE!')).toBeNull();
    expect(cellDate(d('2026-06-12'))).toBe('2026-06-12');
    expect(cellDate(45971)).toBe('2025-11-10');
    expect(cellDate('7/1/2021')).toBe('2021-01-07');
  });
});

describe('parseRegistro', () => {
  const rows: Cell[][] = [
    HEADER,
    [1, d('2015-09-04'), '#VALUE!', 'REP', 'Compra', 400, 12, 5.35, 1, 4805.35, null, null, 'C-1'],
    [2, d('2015-09-04'), '#VALUE!', 'REP', 'Scrip', 18, null, null, 1, 0, null, null, 'C-1'],
    [3, d('2016-06-01'), '#VALUE!', 'REP', 'Dividendo', null, null, -100, 1, -100, null, null, null],
    [4, d('2021-01-07'), '#VALUE!', 'REP', 'Vta dchos', null, null, 6.24, 1, 6.24, null, null, null],
    [5, d('2026-07-15'), '#VALUE!', 'IBM', 'Compra', 13, 220, 3.43, 1.139178994495296, 2513.59, null, null, 'C-5'],
    [6, d('2026-06-11'), '#VALUE!', 'REP', 'Venta', -418, 18.55, 4.12, 1, -7749.78, null, null, 'V-6'],
    [7, d('2026-07-15'), '#VALUE!', 'CLNX', 'Prima de emisión', null, null, -75.75, 1, -75.75, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
  ];

  it('traduce signos, comisiones y tipos', () => {
    const p = parseRegistro(rows, (t) => ({ broker: t === 'REP' ? 'ING' : 'MyInvestor', needsReview: t === 'IBM' }));
    expect(p.skipped).toBe(1);
    expect(p.warnings).toEqual([]);
    const ops = p.operations.map((o) => operationInputSchema.parse(o));
    expect(ops.map((o) => o.type)).toEqual(['buy', 'scrip', 'dividend', 'rights_sale', 'buy', 'sell', 'issue_premium']);
    expect(ops[0]).toMatchObject({ shares: 400, price: 12, fees: 5.35, amountEur: 4805.35, broker: 'ING', source: 'excel', sourceRef: 1 });
    expect(ops[2]).toMatchObject({ amountEur: 100 });
    expect(ops[3]).toMatchObject({ amountEur: 0, fees: 6.24 });
    expect(ops[4]).toMatchObject({ fxRate: 1.139178994495296, needsReview: true, broker: 'MyInvestor' });
    expect(ops[5]).toMatchObject({ shares: 418, amountEur: 7749.78 });
    expect(p.instruments).toEqual([
      { ticker: 'REP', symbol: 'REP.MC', currency: 'EUR' },
      { ticker: 'IBM', symbol: 'IBM', currency: 'USD' },
      { ticker: 'CLNX', symbol: 'CLNX.MC', currency: 'EUR' },
    ]);
    const l = computeLedger(ops.map((o, i) => ({ ...o, id: i + 1 })));
    expect(l.issues).toEqual([]);
    expect(l.byTicker.get('REP')!.shares).toBe(0);
  });

  it('propone GRF-P.MC para Grifols B', () => {
    const p = parseRegistro([HEADER, [1, d('2026-04-13'), null, 'GRF.P', 'Compra', 100, 7, 2, 1, 702, null, null, null]]);
    expect(p.instruments[0]!.symbol).toBe('GRF-P.MC');
  });

  it('falla con un mensaje claro si no es la hoja Registro', () => {
    expect(() => parseRegistro([['a', 'b']])).toThrow(/cabecera/);
  });
});

describe('parseResumenTotals', () => {
  it('lee la fila de totales', () => {
    const t = parseResumenTotals([
      ['Resumen', null, null, null, null, 'Valoración acciones en cartera', 'Variación en el día', null, 'P/G no realizadas', 'P/G realizadas', 'Dividendos y otros', 'P/G totales'],
      [null, null, null, null, null, 100, -1, 0, 10, 20, 30, 60],
    ]);
    expect(t).toEqual({ valueEur: 100, unrealizedEur: 10, realizedEur: 20, incomeEur: 30, totalEur: 60 });
  });
});
