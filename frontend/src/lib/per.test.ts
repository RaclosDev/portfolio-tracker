import { describe, expect, it } from 'vitest';
import { num, price } from './format.ts';
import { perAt, perTooltip } from './per.ts';

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

describe('perTooltip', () => {
  it('muestra el PER actual y una línea por cada precio de compra', () => {
    expect(perTooltip(20, 100, [90, 80], 'EUR')).toBe(
      [
        `PER actual: ${num(20, 1)}`,
        `Compra 1 (${price(90, 'EUR')}): PER ${num(18, 1)}`,
        `Compra 2 (${price(80, 'EUR')}): PER ${num(16, 1)}`,
      ].join('\n'),
    );
  });

  it('respeta la divisa del valor (peniques incluidos)', () => {
    expect(perTooltip(10, 500, [400], 'GBp')).toBe(`PER actual: ${num(10, 1)}\nCompra 1 (${price(400, 'GBp')}): PER ${num(8, 1)}`);
  });

  it('sin PER o sin niveles no hay hover', () => {
    expect(perTooltip(null, 100, [90])).toBeUndefined();
    expect(perTooltip(-3, 100, [90])).toBeUndefined();
    expect(perTooltip(20, 100, [])).toBeUndefined();
    expect(perTooltip(20, null, [90])).toBeUndefined();
  });
});
