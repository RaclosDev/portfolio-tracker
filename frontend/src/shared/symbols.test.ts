import { describe, expect, it } from 'vitest';
import { displayTicker, isinInSymbol, tickerFromSymbol } from './symbols.ts';

describe('tickerFromSymbol', () => {
  it('saca el ticker de los símbolos de cotización', () => {
    expect(tickerFromSymbol('FT:SEC0:GER:EUR')).toBe('SEC0');
    expect(tickerFromSymbol('ft:IE00B4L5Y983:EUR')).toBe('IE00B4L5Y983');
    expect(tickerFromSymbol('XETRA:JE00B588CD74')).toBe('JE00B588CD74');
    expect(tickerFromSymbol('TEF.MC')).toBe('TEF');
    expect(tickerFromSymbol('GRF-P.MC')).toBe('GRF.P');
    expect(tickerFromSymbol('SEC0.DE')).toBe('SEC0.DE');
    expect(tickerFromSymbol('AAPL')).toBe('AAPL');
  });

  it('el ticker guardado manda sobre el del símbolo', () => {
    expect(displayTicker({ ticker: 'SEMI', symbol: 'FT:SEC0:GER:EUR' })).toBe('SEMI');
    expect(displayTicker({ ticker: null, symbol: 'FT:SEC0:GER:EUR' })).toBe('SEC0');
  });

  it('encuentra el ISIN dentro del símbolo', () => {
    expect(isinInSymbol('FT:IE00B4L5Y983:EUR')).toBe('IE00B4L5Y983');
    expect(isinInSymbol('IWDA.AS')).toBeNull();
  });
});
