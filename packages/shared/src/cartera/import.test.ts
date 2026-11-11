import { describe, expect, it } from 'vitest';
import {
  detectImportColumns, detectImportHeader, discoverImportInstruments, importDate, importMappingProblems,
  importNumber, importOptionsSchema, operationFingerprint, previewImport, type ImportOptions,
} from './import.ts';
import { instrumentInputSchema, operationInputSchema } from './schemas.ts';
import type { Cell } from './excel.ts';

const header = ['Fecha', 'Ticker', 'Tipo', 'Cantidad', 'Precio', 'Importe', 'Comisiones', 'Divisa', 'Cambio'];
const options = (patch: Partial<ImportOptions> = {}) => importOptionsSchema.parse({ columns: detectImportColumns(header), amountCurrency: 'instrument', ...patch });
const preview = (data: Cell[][], opts = options()) => previewImport([header, ...data], 0, opts, discoverImportInstruments(data, opts, []));
const buy: Cell[] = ['2026-01-15', 'AAA', 'Compra', 10, 12, -122, 2, 'EUR', 1];

describe('reconocimiento de columnas y valores', () => {
  it('localiza una tabla tras un preámbulo y no elige entre dos fechas o importes', () => {
    expect(detectImportHeader([['Exportación'], [], header, buy])).toBe(2);
    expect(detectImportColumns(['Trade date', 'Date', 'ISIN', 'Quantity', 'Amount', 'Total', 'Currency'])).toEqual({ isin: 2, shares: 3, currency: 6 });
    expect(importMappingProblems(options({ columns: { date: 0, ticker: 0, amount: 2 }, amountCurrency: undefined }))).toHaveLength(3);
  });

  it('vincula por ISIN sin perder el símbolo ni la ficha existente', () => {
    const existing = instrumentInputSchema.parse({ ticker: 'FUND', isin: 'IE0000000001', name: 'Fondo', currency: 'EUR', symbol: 'FUND.MC' });
    const opts = options({ columns: { isin: 0, type: 1 } });
    expect(discoverImportInstruments([['IE0000000001', 'Compra']], opts, [existing])[0]).toMatchObject({ ...existing, key: 'IE0000000001' });
  });

  it('no mezcla dos ISIN ni dos divisas con el mismo identificador', () => {
    const opts = options({ columns: { ticker: 0, isin: 1, currency: 2, type: 3 } });
    expect(discoverImportInstruments([['A', 'IE0000000001', 'EUR', 'buy'], ['A', 'IE0000000002', 'EUR', 'buy']], opts, [])[0]?.problem).toContain('varios ISIN');
    expect(discoverImportInstruments([['A', '', 'EUR', 'buy'], ['A', '', 'USD', 'buy']], opts, [])[0]?.problem).toContain('varias divisas');
  });

  it('vincula los códigos completos de fondos a Yahoo sin inventar símbolos para ISIN o tickers ambiguos', () => {
    const opts = options({ columns: { ticker: 0, type: 1 } });
    const tickers = ['0P0001OJNQ.F', '0P0001F2GG.F', '0P0001F2GG', 'IE00B3VXGD32', 'AAA', '0P0001F2GG.F.MC'];
    expect(discoverImportInstruments(tickers.map((ticker) => [ticker, 'Compra']), opts, [])
      .map((i) => i.symbol)).toEqual(['0P0001OJNQ.F', '0P0001F2GG.F', '0P0001F2GG', null, null, null]);
  });

  it('conserva la vinculación existente de un fondo, incluso si se dejó vacía', () => {
    const opts = options({ columns: { ticker: 0, type: 1 } });
    for (const symbol of [null, 'OTRA.CLASE']) {
      const existing = instrumentInputSchema.parse({ ticker: '0P0001F2GG.F', symbol });
      expect(discoverImportInstruments([['0P0001F2GG.F', 'Compra']], opts, [existing])[0]?.symbol).toBe(symbol);
    }
  });
});

describe('fechas y números de exportaciones', () => {
  it('pide aclarar fechas ambiguas y rechaza fechas imposibles', () => {
    expect(() => importDate('03/04/2026', 'auto')).toThrow('ambigua');
    expect(importDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(importDate('03/04/2026', 'mdy')).toBe('2026-03-04');
    expect(importDate('12/31/2026', 'auto')).toBe('2026-12-31');
    expect(() => importDate('2026-02-31', 'auto')).toThrow('no existe');
    expect(() => importDate('31/02/2026', 'dmy')).toThrow('no existe');
  });

  it('conserva el día en fechas Excel y fechas con hora del extracto', () => {
    expect(importDate(46387, 'auto')).toBe('2026-12-31');
    expect(importDate(new Date('2026-01-10T00:00:00Z'), 'auto')).toBe('2026-01-10');
    expect(importDate('2026-01-10T23:00:00-05:00', 'auto')).toBe('2026-01-10');
  });

  it('distingue decimales, agrupaciones y cantidades ambiguas sin redondearlas', () => {
    expect(importNumber('1.234,56 €', 'auto')).toBe(1234.56);
    expect(importNumber('($1,234.56)', 'auto')).toBe(-1234.56);
    expect(importNumber(1.234, 'auto')).toBe(1.234);
    expect(() => importNumber('1.234', 'auto')).toThrow('ambiguo');
    expect(importNumber('1.234', 'comma')).toBe(1234);
    expect(importNumber('1.234', 'dot')).toBe(1.234);
    expect(() => importNumber('12,34,56', 'comma')).toThrow('no válido');
    expect(() => importNumber('abc', 'auto')).toThrow('no válido');
  });
});

describe('vista previa de operaciones', () => {
  it('convierte compras con cargos negativos sin duplicar sus comisiones', () => {
    const result = preview([buy])[0]!;
    expect(result.errors).toEqual([]);
    expect(result.operation).toMatchObject({ date: '2026-01-15', ticker: 'AAA', type: 'buy', shares: 10, amountEur: 122, fees: 2, source: 'excel', sourceRef: null });
  });

  it('calcula importes de compras y ventas cuando solo vienen cantidad y precio', () => {
    const row = [...buy]; row[5] = null;
    expect(preview([row])[0]?.operation?.amountEur).toBe(122);
    row[2] = 'Venta'; row[3] = -10;
    expect(preview([row])[0]?.operation).toMatchObject({ shares: 10, amountEur: 118 });
  });

  it('convierte importes y comisiones con el cambio histórico, y bloquea si falta', () => {
    const row = [...buy]; row[7] = 'USD'; row[8] = 1.25;
    expect(preview([row])[0]?.operation?.amountEur).toBeCloseTo(97.6);
    expect(preview([row], options({ amountCurrency: 'EUR' }))[0]?.operation?.amountEur).toBe(122);
    expect(preview([row], options({ amountCurrency: 'EUR', amountIncludesFees: false }))[0]?.operation?.amountEur).toBeCloseTo(123.6);
    row[8] = null;
    expect(preview([row])[0]?.operation).toBeUndefined();
    expect(preview([row])[0]?.errors.join(' ')).toContain('histórico');
  });

  it('reconstruye el bruto de un dividendo neto con retenciones en euros', () => {
    const opts = options({ columns: { ...options().columns, withholdingEs: 9, withholdingForeign: 10 }, incomeIsNet: true });
    const row = ['2026-03-15', 'FUND', 'Dividend', null, null, 80, 1, 'EUR', 1, 15, 4];
    expect(preview([row], opts)[0]?.operation).toMatchObject({ type: 'dividend', amountEur: 100, withholdingEs: 15, withholdingForeign: 4 });
  });

  it('pide resolver tipos desconocidos una vez o permite excluir esas filas', () => {
    const row = [...buy]; row[2] = 'SUSCR. FONDO';
    expect(preview([row])[0]?.operation).toBeUndefined();
    expect(preview([row], options({ typeMap: { 'suscr fondo': 'buy' } }))[0]?.operation?.type).toBe('buy');
    expect(preview([row], options({ typeMap: { 'suscr fondo': 'skip' } }))[0]).toMatchObject({ skipped: true, errors: [] });
  });

  it('permite tipo fijo y mantiene líneas originales sin saltarse errores o totales', () => {
    const opts = options({ columns: { date: 0, ticker: 1, shares: 3, amount: 5 }, defaultType: 'buy' });
    const rows = preview([buy, [], ['Total', '', '', '', '', 122]], opts);
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
    expect(rows[0]?.operation?.type).toBe('buy');
    expect(rows[1]?.errors.length).toBeGreaterThan(0);
    expect(rows[1]?.operation).toBeUndefined();
  });

  it('no convierte en cero una cantidad ilegible', () => {
    const row = [...buy]; row[6] = 'desconocido';
    expect(preview([row])[0]?.operation).toBeUndefined();
    expect(preview([row])[0]?.errors.join(' ')).toContain('Comisiones');
  });

  it('detecta coincidencias independientemente de notas y origen, pero distingue importes y bróker', () => {
    const op = operationInputSchema.parse({ date: '2026-01-01', ticker: 'A', type: 'buy', shares: 1, amountEur: 10 });
    expect(operationFingerprint(op)).toBe(operationFingerprint({ ...op, source: 'excel', sourceRef: 12, notes: 'Importado', withholdingEs: 0 }));
    expect(operationFingerprint(op)).not.toBe(operationFingerprint({ ...op, amountEur: 11 }));
    expect(operationFingerprint(op)).not.toBe(operationFingerprint({ ...op, broker: 'Otro' }));
  });
});
