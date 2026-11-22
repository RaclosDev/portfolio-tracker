import { describe, expect, it } from 'vitest';
import { perAt, perLevels } from './per.ts';

describe('perAt', () => {
  it('escala el PER actual al precio dado', () => {
    expect(perAt(20, 100, 80)).toBeCloseTo(16);
    expect(perAt(12.5, 50, 50)).toBeCloseTo(12.5);
  });

  it('sin PER positivo o sin precio actual no hay cálculo', () => {
    expect(perAt(null, 100, 80)).toBeNull();
    expect(perAt(undefined, 100, 80)).toBeNull();
    expect(perAt(-5, 100, 80)).toBeNull();
    expect(perAt(0, 100, 80)).toBeNull();
    expect(perAt(20, null, 80)).toBeNull();
    expect(perAt(20, 0, 80)).toBeNull();
    expect(perAt(20, 100, 0)).toBeNull();
  });
});

describe('perLevels', () => {
  it('da el PER a cada precio de compra, con su número de nivel', () => {
    const r = perLevels(20, 100, [90, 0, 80]);
    expect(r.map((l) => [l.n, l.price])).toEqual([[1, 90], [3, 80]]);
    expect(r[0]?.per).toBeCloseTo(18);
    expect(r[1]?.per).toBeCloseTo(16);
  });

  it('sin PER o sin niveles no hay nada', () => {
    expect(perLevels(null, 100, [90])).toEqual([]);
    expect(perLevels(-3, 100, [90])).toEqual([]);
    expect(perLevels(20, 100, [])).toEqual([]);
    expect(perLevels(20, null, [90])).toEqual([]);
  });
});
