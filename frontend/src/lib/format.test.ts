import { describe, expect, it } from 'vitest';
import { firstInvalidNumber, parseDecimal } from './format.ts';

describe('parseDecimal', () => {
  it('lo que se teclea: el punto es decimal y la coma también', () => {
    expect(parseDecimal('8,5')).toBe(8.5);
    expect(parseDecimal('8.5')).toBe(8.5);
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
    expect(parseDecimal('')).toBeNull();
  });

  it('en ficheros, «1.500» son mil quinientos y no uno con cinco', () => {
    expect(parseDecimal('1.500', { thousandsDot: true })).toBe(1500);
    expect(parseDecimal('12.500', { thousandsDot: true })).toBe(12500);
    expect(parseDecimal('1.234.567', { thousandsDot: true })).toBe(1234567);
    expect(parseDecimal('-2.500,25', { thousandsDot: true })).toBe(-2500.25);
  });

  it('en ficheros, lo que no tiene forma de miles sigue siendo decimal', () => {
    expect(parseDecimal('0.500', { thousandsDot: true })).toBe(0.5);
    expect(parseDecimal('1.5', { thousandsDot: true })).toBe(1.5);
    expect(parseDecimal('12.34', { thousandsDot: true })).toBe(12.34);
    expect(parseDecimal('1,5', { thousandsDot: true })).toBe(1.5);
  });
});

describe('firstInvalidNumber', () => {
  it('devuelve el primer texto que no es un número positivo', () => {
    expect(firstInvalidNumber(['45,2', '', '  ', '8.5'])).toBeNull();
    expect(firstInvalidNumber(['45,2', '45,2 USD'])).toBe('45,2 USD');
    expect(firstInvalidNumber(['abc', '0'])).toBe('abc');
    expect(firstInvalidNumber(['0'])).toBe('0');
  });
});
