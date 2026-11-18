import { describe, expect, it } from 'vitest';
import { companyKey, computeExposure, type FundComposition } from './exposure.ts';
import type { HoldingRow } from './view.ts';

const holding = (ticker: string, name: string, valueEur: number | null, quoteType = 'EQUITY', isin: string | null = null) =>
  ({ ticker, name, valueEur, quote: { quoteType }, instrument: { isin } }) as unknown as HoldingRow;
const composition = (...holdings: [string, string | null, number][]): FundComposition => ({
  holdings: holdings.map(([name, isin, weight]) => ({ name, isin, ticker: null, weight })),
  asOf: '2026-10-31', source: 'prueba', fetchedAt: '2026-11-17T00:00:00.000Z',
});

describe('exposición real', () => {
  it('reconoce la misma empresa aunque cada fuente la nombre distinto', () => {
    expect(companyKey('NVIDIA Corp.')).toBe(companyKey('Nvidia'));
    expect(companyKey('Alphabet Inc Class A')).toBe(companyKey('Alphabet Inc. (C)'));
    expect(companyKey('Taiwan Semiconductor Manufacturing Co Ltd ADR')).toBe(companyKey('TSMC'));
    expect(companyKey('Industria de Diseño Textil, S.A.')).toBe('industria de diseno textil');
    expect(companyKey('Apple Inc.')).not.toBe(companyKey('Applied Materials Inc.'));
    expect(companyKey('Eli Lilly and Co')).toBe(companyKey('Eli Lilly'));
    expect(companyKey('Amazon.com Inc')).toBe(companyKey('Amazon'));
    expect(companyKey('Johnson & Johnson')).toBe('johnson johnson');
  });

  it('suma lo directo y lo que llevan los fondos, y deja aparte lo que no desglosan', () => {
    const open = [
      holding('NVDA', 'NVIDIA Corporation', 1000, 'EQUITY', 'US67066G1040'),
      holding('SP500', 'ETF S&P 500', 10000, 'ETF'),
      holding('SEMI', 'ETF Semiconductores', 10000, 'ETF'),
      holding('MIX', 'Fondo sin datos', 2000, 'MUTUALFUND'),
      holding('SIN', 'Sin precio', null),
    ];
    const result = computeExposure(open, {
      SP500: composition(['Nvidia', 'US67066G1040', 0.07], ['Apple', 'US0378331005', 0.06]),
      SEMI: composition(['NVIDIA Corp', null, 0.2], ['Taiwan Semiconductor Manufacturing Co Ltd ADR', null, 0.1]),
      MIX: null,
    });
    expect(result.totalEur).toBe(23000);
    const nvidia = result.rows[0]!;
    expect(nvidia).toMatchObject({ name: 'NVIDIA Corporation', isin: 'US67066G1040', directEur: 1000 });
    expect(nvidia.fundsEur).toBeCloseTo(2700);
    expect(nvidia.totalEur).toBeCloseTo(3700);
    expect(nvidia.weight).toBeCloseTo(3700 / 23000);
    expect(nvidia.parts.map((p) => p.ticker)).toEqual(['SEMI', 'NVDA', 'SP500']);
    expect(result.rows.map((r) => r.name)).toEqual(['NVIDIA Corporation', 'Taiwan Semiconductor Manufacturing Co Ltd ADR', 'Apple']);
    // Resto: 87 % del S&P, 70 % del de semiconductores y el fondo sin composición entero.
    expect(result.rest.map((p) => [p.ticker, Math.round(p.eur), p.weight])).toEqual([['SP500', 8700, 0.87], ['SEMI', 7000, 0.7], ['MIX', 2000, null]]);
    expect(result.restEur + result.rows.reduce((s, r) => s + r.totalEur, 0)).toBeCloseTo(23000);
  });

  it('trata como fondo lo que tiene composición aunque no se conozca su tipo, e ignora pesos imposibles', () => {
    const result = computeExposure([holding('X', 'Fondo por ISIN', 1000, '')], {
      X: composition(['Uno', null, 0.6], ['Dos', null, 0.6], ['Tres', null, -1], ['Cuatro', null, 0.1]),
    });
    expect(result.rows.map((r) => [r.name, Math.round(r.fundsEur)])).toEqual([['Uno', 600], ['Cuatro', 100]]);
    expect(result.restEur).toBeCloseTo(300);
  });

  it('junta en una sola parte las dos clases de una empresa dentro del mismo fondo', () => {
    const result = computeExposure([holding('SP500', 'ETF S&P 500', 1000, 'ETF')], {
      SP500: composition(['Alphabet Inc Class A', 'US02079K3059', 0.03], ['Alphabet Inc Class C', 'US02079K1079', 0.02]),
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.parts).toHaveLength(1);
    expect(result.rows[0]!.parts[0]).toMatchObject({ ticker: 'SP500', eur: 50, weight: 0.05 });
  });
});
