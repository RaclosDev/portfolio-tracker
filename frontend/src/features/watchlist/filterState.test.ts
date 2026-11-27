import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeFilterCount } from './filterState.ts';

describe('filtros de la lista', () => {
  it('sin filtros no cuenta ninguno', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it('el filtro de mercado cuenta como filtro activo', () => {
    expect(activeFilterCount({ ...NO_FILTERS, market: 'open' })).toBe(1);
    expect(activeFilterCount({ ...NO_FILTERS, market: 'closed', currency: 'USD' })).toBe(2);
  });

  it('quitar los filtros deja todos en «all»', () => {
    const all = { status: 'reached', type: 'ETF', currency: 'EUR', market: 'closed' } as const;
    expect(activeFilterCount(all)).toBe(4);
    expect(activeFilterCount({ ...NO_FILTERS })).toBe(0);
  });
});
