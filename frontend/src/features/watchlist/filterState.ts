import type { Filter } from './StatusFilter.tsx';
import type { MarketFilter, TypeFilter } from './TagFilters.tsx';

/** Los cuatro filtros de la lista de seguimiento: estado, tipo, divisa y mercado. */
export interface ListFilters {
  status: Filter;
  type: TypeFilter;
  currency: string;
  market: MarketFilter;
}

export const NO_FILTERS: ListFilters = { status: 'all', type: 'all', currency: 'all', market: 'all' };

/** Cuántos filtros están puestos (el de mercado también cuenta). */
export const activeFilterCount = (f: ListFilters) => Object.values(f).filter((value) => value !== 'all').length;
