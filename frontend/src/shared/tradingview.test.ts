import { describe, expect, it } from 'vitest';
import { tradingViewSymbol } from './tradingview.ts';

describe('símbolo de TradingView', () => {
  it('traduce los símbolos de Yahoo y de FT a «BOLSA:TICKER»', () => {
    expect(tradingViewSymbol('NVDA', 'EQUITY')).toBe('NVDA');
    expect(tradingViewSymbol('BRK-B', 'EQUITY')).toBe('BRK.B');
    expect(tradingViewSymbol('SAN.MC', 'EQUITY')).toBe('BME:SAN');
    expect(tradingViewSymbol('IWDA.AS', 'ETF')).toBe('EURONEXT:IWDA');
    expect(tradingViewSymbol('exvm.de', 'ETF')).toBe('XETR:EXVM');
    expect(tradingViewSymbol('VUSA.L')).toBe('LSE:VUSA');
    expect(tradingViewSymbol('FT:SEC0:GER:EUR', 'ETF')).toBe('XETR:SEC0');
    expect(tradingViewSymbol('FT:DECK:NYQ')).toBe('NYSE:DECK');
    expect(tradingViewSymbol('BTC-USD', 'CRYPTOCURRENCY')).toBe('BTCUSD');
    expect(tradingViewSymbol('EURUSD=X', 'CURRENCY')).toBe('FX_IDC:EURUSD');
  });

  it('no inventa símbolo para lo que TradingView no tiene', () => {
    for (const symbol of ['ES0112609005', '0P00016YQ5.F', 'FT:ES0112609005:EUR', 'XETRA:IE00B4L5Y983', '^GSPC', 'GC=F', 'ABC.ZZ', ''])
      expect(tradingViewSymbol(symbol)).toBeNull();
    expect(tradingViewSymbol('VFIAX', 'MUTUALFUND')).toBeNull();
  });
});
