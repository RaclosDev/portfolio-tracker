import { describe, expect, it } from 'vitest';
import { parseCsv, parseTable, symbolCandidates, toIsoDate } from './importTable.ts';

describe('parseTable', () => {
  it('entiende el Excel original («Vigilar nuevas»)', () => {
    const header = ['Acción', 'Ticker', 'Variación dia', 'P Actual', 'P Com 1', 'Diferencia', 'P Com 2', 'Diferencia', null, 'P.O. R4', null, 'Invertir €', 'acc calc', 'Acc compr', 'Neto', 'Dif. en €', 'Hasta', 'Notas'];
    const t = parseTable([
      ['Vigilar nuevas'],
      header,
      ['#VALUE!', 'ALM', -0.0017, 11.22, 8.5, -0.24, 7.6, -0.32, null, 14, 0.24, 2500, 294.1, null, 0, 0, null, null],
      ['#VALUE!', 'COL', 0.006, 5.27, 4.64, -0.11, null, null, null, 8.3, 0.57, 2500, 538.8, 540, 2505.6, 340.2, new Date(Date.UTC(2026, 11, 31)), 'revisar'],
      [null, null, null],
      ['#VALUE!', 'ALM', 1, 2, 3],
    ])!;
    expect(t.headerRow).toBe(1);
    expect(t.skipped).toBe(1);
    expect(t.rows).toEqual([
      { symbol: 'ALM', buyPrices: [8.5, 7.6], brokerTarget: 14, brokerName: 'Renta 4', investAmount: 2500 },
      {
        symbol: 'COL',
        buyPrices: [4.64],
        brokerTarget: 8.3,
        brokerName: 'Renta 4',
        investAmount: 2500,
        sharesOverride: 540,
        orderActive: true,
        orderUntil: '2026-12-31',
        notes: 'revisar',
      },
    ]);
  });

  it('entiende lo que exporta la app y no toca lo que viene vacío', () => {
    const t = parseTable([
      ['Nombre', 'Ticker', 'Compra 1', 'Dist. 1', 'Objetivo bróker', 'Bróker', 'Orden', 'Precio orden', 'Hasta'],
      ['Fluidra', 'fdr.mc', '17,01', '-12 %', '', '', 'No', '', ''],
      ['Viscofan', 'VIS.MC', 46.1, null, 72.7, 'Renta 4', 'Sí', 46, '15/01/27'],
    ])!;
    expect(t.rows[0]).toEqual({ symbol: 'FDR.MC', name: 'Fluidra', buyPrices: [17.01], orderActive: false });
    expect(t.rows[1]).toMatchObject({ orderActive: true, orderPrice: 46, orderUntil: '2027-01-15', brokerName: 'Renta 4' });
  });

  it('sin columna de ticker no hay tabla', () => {
    expect(parseTable([['Nombre', 'Precio'], ['A', 1]])).toBeNull();
  });
});

describe('parseCsv y fechas', () => {
  it('respeta sep=, los preámbulos y los separadores dentro de títulos entrecomillados', () => {
    expect(parseCsv('sep=;\r\nFecha;Importe\n2026-01-01;12,30')).toEqual([['Fecha', 'Importe'], ['2026-01-01', '12,30']]);
    expect(parseCsv('Extracto\nFecha,Ticker\n2026-01-01,AAA')).toEqual([['Extracto'], ['Fecha', 'Ticker'], ['2026-01-01', 'AAA']]);
    expect(parseCsv('"Nombre, ticker, ISIN";Cantidad\n"Valor, S.A.";1')).toEqual([['Nombre, ticker, ISIN', 'Cantidad'], ['Valor, S.A.', '1']]);
    expect(() => parseCsv('Ticker,Notas\nAAA,"incompleto')).toThrow('sin cerrar');
  });
  it('lee CSV con punto y coma, comillas y saltos de línea', () => {
    expect(parseCsv('﻿Ticker;Notas\r\nITX.MC;"hola; ""amigo"""\nSAN.MC;\n')).toEqual([
      ['Ticker', 'Notas'],
      ['ITX.MC', 'hola; "amigo"'],
      ['SAN.MC', ''],
    ]);
  });

  it('convierte fechas de Excel', () => {
    expect(toIsoDate(46387)).toBe('2026-12-31');
    expect(toIsoDate('2026-1-5')).toBe('2026-01-05');
    expect(toIsoDate('5/1/2026')).toBe('2026-01-05');
    expect(toIsoDate('mañana')).toBeNull();
  });
});

describe('symbolCandidates', () => {
  it('traduce los tickers del Excel a los de Yahoo', () => {
    expect(symbolCandidates('4COP XETRA', '.MC')).toEqual(['4COP.DE']);
    expect(symbolCandidates('GRF.P', '.MC')).toEqual(['GRF-P.MC', 'GRF-P', 'GRF.P']);
    expect(symbolCandidates('ALM', '.MC')).toEqual(['ALM.MC', 'ALM']);
    expect(symbolCandidates('BP.L', '.MC')).toEqual(['BP.L']);
    expect(symbolCandidates('0P0001OJNQ.F', '.MC')).toEqual(['0P0001OJNQ.F']);
    expect(symbolCandidates('0P0001OJNQ', '.MC')).toEqual(['0P0001OJNQ']);
    expect(symbolCandidates('IE00B3VXGD32', '.MC')).toEqual(['IE00B3VXGD32']);
    expect(symbolCandidates('MCD', '')).toEqual(['MCD']);
  });
});
