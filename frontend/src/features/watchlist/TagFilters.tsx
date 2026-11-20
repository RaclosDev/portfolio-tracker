import { kindOfQuoteType, type InstrumentKind, type TagNames, type WatchlistRow } from '@/shared';

export type TypeFilter = 'all' | 'EQUITY' | 'ETF' | 'FUND';

/** Tipo de valor según el mercado: acción, ETF, fondo u otro. */
export const rowType = (r: WatchlistRow): InstrumentKind => kindOfQuoteType(r.quote?.quoteType) ?? 'OTHER';

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
    { id: 'FUND', label: 'Fondos', title: 'Solo fondos de inversión' },
  ];
  return (
    <div className="tag-filters">
      <div className="segmented" role="group" aria-label="Filtrar por tipo">
        <span className="watchlist-filter-label" aria-hidden>Tipo</span>
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
      {(currencies.length > 1 || currency !== 'all') && (
        <div className="segmented" role="group" aria-label="Filtrar por divisa">
          <span className="watchlist-filter-label" aria-hidden>Divisa</span>
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
