import type { TagNames, WatchlistRow } from '@watchlist/shared';

export type TypeFilter = 'all' | 'EQUITY' | 'ETF';

/** Tipo de valor según el mercado: acción (EQUITY), ETF u otro. */
export const rowType = (r: WatchlistRow): 'EQUITY' | 'ETF' | 'OTHER' =>
  r.quote?.quoteType === 'ETF' ? 'ETF' : r.quote?.quoteType === 'EQUITY' ? 'EQUITY' : 'OTHER';

interface Props {
  type: TypeFilter;
  onType: (t: TypeFilter) => void;
  currency: string;
  currencies: string[];
  onCurrency: (c: string) => void;
  names: TagNames;
}

/** Filtros por etiqueta: tipo de valor y divisa. */
export function TagFilters({ type, onType, currency, currencies, onCurrency, names }: Props) {
  const TYPES: { id: TypeFilter; label: string; title?: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'EQUITY', label: names.equity, title: 'Solo acciones' },
    { id: 'ETF', label: names.etf, title: 'Solo ETF' },
  ];
  return (
    <div className="tag-filters">
      <div className="segmented" role="group" aria-label="Filtrar por tipo">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={type === t.id ? 'on' : ''}
            aria-pressed={type === t.id}
            title={t.title}
            onClick={() => onType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {currencies.length > 1 && (
        <div className="segmented" role="group" aria-label="Filtrar por divisa">
          {['all', ...currencies].map((c) => (
            <button
              key={c}
              type="button"
              className={currency === c ? 'on' : ''}
              aria-pressed={currency === c}
              onClick={() => onCurrency(c)}
            >
              {c === 'all' ? 'Todas' : c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
