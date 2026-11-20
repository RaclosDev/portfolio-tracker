import { describe, expect, it } from 'vitest';
import { instrumentKind } from './kind.ts';

describe('tipo de valor', () => {
  it('manda el tipo que da el mercado', () => {
    expect(instrumentKind({ ticker: 'NVDA', symbol: 'NVDA' }, 'EQUITY')).toBe('EQUITY');
    expect(instrumentKind({ ticker: 'SEC0', symbol: 'FT:SEC0:GER:EUR' }, 'ETF')).toBe('ETF');
    expect(instrumentKind({ ticker: 'AZV', symbol: '0P00016YQ5.F' }, 'MUTUALFUND')).toBe('FUND');
    expect(instrumentKind({ ticker: 'BTC', symbol: 'BTC-USD' }, 'CRYPTOCURRENCY')).toBe('OTHER');
  });

  it('sin cotización (lo ya vendido) lo deduce del símbolo y del nombre', () => {
    expect(instrumentKind({ ticker: 'ES0112609005', symbol: 'ES0112609005', name: 'AZVALOR BLUE CHIPS, FI' })).toBe('FUND');
    expect(instrumentKind({ ticker: 'VGSI', symbol: 'FT:IE00B03HCZ61:EUR', name: null })).toBe('FUND');
    expect(instrumentKind({ ticker: 'AZV', symbol: '0P00016YQ5.F', name: null })).toBe('FUND');
    expect(instrumentKind({ ticker: 'IWDA', symbol: 'IWDA.AS', name: 'iShares Core MSCI World UCITS ETF USD (Acc)' })).toBe('ETF');
    expect(instrumentKind({ ticker: 'XETRA:IE000I8KRLL9', symbol: null, name: 'iShares MSCI Global Semiconductors UCITS ETF USD Acc.' })).toBe('ETF');
    expect(instrumentKind({ ticker: 'SAN', symbol: 'SAN.MC', name: 'Banco Santander, S.A.' })).toBe('EQUITY');
    expect(instrumentKind({ ticker: 'TEF', symbol: null, name: null })).toBe('EQUITY');
  });
});
