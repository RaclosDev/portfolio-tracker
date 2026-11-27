import { describe, expect, it } from 'vitest';
import type { Candle } from '@/shared';
import { adjustForDividends } from './dividendAdjust.ts';

const bar = (t: string, c: number): Candle => ({ t, o: c, h: c + 1, l: c - 1, c });

describe('ajuste por dividendos', () => {
  const bars = [bar('2024-01-01', 10), bar('2024-01-02', 10), bar('2024-01-03', 9), bar('2024-01-04', 9)];

  it('sin dividendos no cambia nada', () => {
    expect(adjustForDividends(bars, [])).toBe(bars);
  });

  it('ajusta lo anterior a la fecha ex con el cierre de la víspera', () => {
    const out = adjustForDividends(bars, [{ date: '2024-01-03', amount: 1 }]);
    expect(out.map((b) => b.c)).toEqual([9, 9, 9, 9]);
    expect(out[0]!.h).toBeCloseTo(11 * 0.9);
    expect(out[3]).toBe(bars[3]);
  });

  it('acumula varios dividendos', () => {
    const out = adjustForDividends(bars, [{ date: '2024-01-04', amount: 0.9 }, { date: '2024-01-02', amount: 1 }]);
    expect(out[0]!.c).toBeCloseTo(10 * 0.9 * 0.9);
    expect(out[1]!.c).toBeCloseTo(10 * 0.9);
    expect(out[2]!.c).toBeCloseTo(9 * 0.9);
    expect(out[3]!.c).toBe(9);
  });

  it('intradía: compara solo el día', () => {
    const intra = [bar('2024-01-02T16:00:00Z', 10), bar('2024-01-03T09:00:00Z', 9)];
    expect(adjustForDividends(intra, [{ date: '2024-01-03', amount: 1 }]).map((b) => b.c)).toEqual([9, 9]);
  });

  it('dividendos fuera del rango no tocan nada', () => {
    expect(adjustForDividends(bars, [{ date: '2025-01-01', amount: 1 }, { date: '2023-06-01', amount: 1 }])).toEqual(bars);
  });
});
