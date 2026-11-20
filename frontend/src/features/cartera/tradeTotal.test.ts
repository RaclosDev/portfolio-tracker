import { describe, expect, it } from 'vitest';
import { tradeTotal } from './tradeTotal.ts';

describe('importe de una compra o venta manual', () => {
  it('suma las comisiones en compras y las resta en ventas', () => {
    expect(tradeTotal('buy', 1, 1, 1, 'EUR', null)).toBe(2);
    expect(tradeTotal('sell', 10, 20, 2, 'EUR', null)).toBe(198);
  });

  it('no trata una divisa extranjera como euros cuando falta el cambio', () => {
    expect(tradeTotal('buy', 10, 50, 5, 'USD', null)).toBeNull();
    expect(tradeTotal('buy', 10, 50, 5, 'USD', 0)).toBeNull();
    expect(tradeTotal('buy', 10, 50, 5, 'USD', -1)).toBeNull();
    expect(tradeTotal('buy', 10, 50, 5, 'USD', 1.1)).toBe(459.09);
    expect(tradeTotal('buy', 10, 50, 5, 'GBP', 0.8)).toBe(631.25);
  });

  it('admite participaciones fraccionadas e ignora un cambio anterior al pasar a euros', () => {
    expect(tradeTotal('buy', 2.5, 100, 1, 'EUR', 1.1)).toBe(251);
    expect(tradeTotal('buy', 2.5, null, 1, 'EUR', 1)).toBeNull();
  });
});
