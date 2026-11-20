import { describe, expect, it } from 'vitest';
import type { Quote } from '@/shared';
import { quoteSources, sourceMark } from './QuoteSources.tsx';

const q = (source: string | undefined, stale = false, fallback = false) => ({ source, stale, fallback }) as Quote;

describe('fuentes de los precios', () => {
  it('marca cada fuente', () => {
    expect(sourceMark('Financial Hub')).toBe('F');
    expect(sourceMark('Yahoo Finance')).toBe('Y');
    expect(sourceMark('FT Markets')).toBe('FT');
    expect(sourceMark('onvista')).toBe('O');
  });

  it('cuenta las fuentes de mayor a menor y no cuenta los datos guardados', () => {
    expect(quoteSources([q('FT Markets'), q('Yahoo Finance'), q('Yahoo Finance', false, true), q('onvista', true), q(undefined), null])).toEqual([
      { source: 'Yahoo Finance', n: 2, fallback: 1, mark: 'Y' },
      { source: 'FT Markets', n: 1, fallback: 0, mark: 'FT' },
    ]);
  });
});
