import type { ExposureRow } from '@watchlist/shared';
import { describe, expect, it } from 'vitest';
import { DIRECT, exposureSources, filterExposure, NO_FILTER } from './exposureFilter.ts';

const row = (name: string, parts: ExposureRow['parts'], isin: string | null = null): ExposureRow => {
  const directEur = parts.reduce((s, p) => s + (p.weight == null ? p.eur : 0), 0);
  const fundsEur = parts.reduce((s, p) => s + (p.weight == null ? 0 : p.eur), 0);
  return { key: name, name, isin, directEur, fundsEur, totalEur: directEur + fundsEur, weight: (directEur + fundsEur) / 1000, parts };
};

const rows = [
  row('NVIDIA Corp', [
    { ticker: 'NVDA', name: 'NVIDIA', eur: 100, weight: null },
    { ticker: 'QUTM', name: 'VanEck Quantum', eur: 50, weight: 0.05 },
    { ticker: 'WQTM', name: 'WisdomTree Quantum', eur: 30, weight: 0.03 },
  ], 'US67066G1040'),
  row('Cameco', [{ ticker: 'NUKL', name: 'VanEck Uranium', eur: 80, weight: 0.08 }]),
  row('Pequeña SA', [{ ticker: 'QUTM', name: 'VanEck Quantum', eur: 5, weight: 0.005 }]),
];

describe('filterExposure', () => {
  it('sin filtros devuelve todo', () => {
    expect(filterExposure(rows, 1000, NO_FILTER)).toHaveLength(3);
  });

  it('busca por nombre sin tildes ni mayúsculas y por ISIN', () => {
    expect(filterExposure(rows, 1000, { ...NO_FILTER, q: 'pequena' }).map((r) => r.name)).toEqual(['Pequeña SA']);
    expect(filterExposure(rows, 1000, { ...NO_FILTER, q: 'us6706' }).map((r) => r.name)).toEqual(['NVIDIA Corp']);
  });

  it('al elegir fondos, los importes son solo los que vienen de ellos', () => {
    const [nvda] = filterExposure(rows, 1000, { ...NO_FILTER, sources: ['QUTM', DIRECT] });
    expect(nvda).toMatchObject({ directEur: 100, fundsEur: 50, totalEur: 150, weight: 0.15 });
    expect(nvda!.parts.map((p) => p.ticker)).toEqual(['NVDA', 'QUTM']);
    expect(filterExposure(rows, 1000, { ...NO_FILTER, sources: ['NUKL'] }).map((r) => r.name)).toEqual(['Cameco']);
  });

  it('solo repetidas y mínimo de importe', () => {
    expect(filterExposure(rows, 1000, { ...NO_FILTER, repeated: true }).map((r) => r.name)).toEqual(['NVIDIA Corp']);
    expect(filterExposure(rows, 1000, { ...NO_FILTER, sources: ['QUTM', 'WQTM'], repeated: true })[0]!.totalEur).toBe(80);
    expect(filterExposure(rows, 1000, { ...NO_FILTER, minEur: 10 })).toHaveLength(2);
  });
});

describe('exposureSources', () => {
  it('lista los orígenes de mayor a menor importe', () => {
    expect(exposureSources(rows).map((s) => [s.label, s.eur])).toEqual([
      ['En directo', 100],
      ['NUKL', 80],
      ['QUTM', 55],
      ['WQTM', 30],
    ]);
  });
});
