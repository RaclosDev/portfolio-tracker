import { describe, expect, it } from 'vitest';
import { proposeTicker } from './proposeTicker.ts';

describe('proposeTicker', () => {
  it('propone el ticker corto y, si ya está cogido, el símbolo entero', () => {
    expect(proposeTicker('SAN.MC', [])).toBe('SAN');
    expect(proposeTicker('FT:SEC0:GER:EUR', [])).toBe('SEC0');
    expect(proposeTicker('IE00B03HCZ61', [])).toBe('IE00B03HCZ61');
    expect(proposeTicker('SAN', [{ ticker: 'SAN' }])).toBe('SAN');
    expect(proposeTicker('SAN.PA', [{ ticker: 'SAN' }])).toBe('SAN.PA');
  });
});
