import type { Bands, StatusNames, WatchlistRow } from '@watchlist/shared';

export type Filter = 'all' | 'reached' | 'veryNear' | 'near' | 'far' | 'veryFar' | 'order';

export const filterRow = (f: Filter) => (r: WatchlistRow) =>
  f === 'all' ? true : f === 'order' ? r.item.orderActive : r.metrics.status === f;

const fmt = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** Explicación de cada tramo con los umbrales actuales (para títulos y ayudas). */
export function bandText(id: Exclude<Filter, 'all' | 'order'>, b: Bands) {
  switch (id) {
    case 'reached':
      return 'El precio ya está por debajo de alguno de tus niveles de compra';
    case 'veryNear':
      return `Le falta caer como mucho un ${fmt(b.veryNear)} % hasta un nivel`;
    case 'near':
      return `Le falta caer entre un ${fmt(b.veryNear)} % y un ${fmt(b.near)} %`;
    case 'far':
      return `Le falta caer entre un ${fmt(b.near)} % y un ${fmt(b.far)} %`;
    case 'veryFar':
      return `Le falta caer más de un ${fmt(b.far)} %`;
  }
}

const STATES = ['reached', 'veryNear', 'near', 'far', 'veryFar'] as const;

interface Props {
  rows: WatchlistRow[];
  bands: Bands;
  names: StatusNames;
  value: Filter;
  onChange: (f: Filter) => void;
}

/** Filtro por estado con el recuento de cada uno (sustituye a las tarjetas de resumen). */
export function StatusFilter({ rows, bands, names, value, onChange }: Props) {
  const options: { id: Filter; label: string; title: string }[] = [
    { id: 'all', label: 'Todos', title: 'Todos los valores de la lista' },
    ...STATES.map((id) => ({ id, label: names[id], title: bandText(id, bands) })),
    { id: 'order', label: 'Con orden', title: 'Tienes una orden de compra puesta en el banco' },
  ];
  return (
    <div className="segmented status-filter" role="group" aria-label="Filtrar por estado">
      <span className="watchlist-filter-label" aria-hidden>Estado</span>
      {options.map((o) => {
        const n = rows.filter(filterRow(o.id)).length;
        return (
          <button
            key={o.id}
            type="button"
            className={`${value === o.id ? 'on' : ''} seg--${o.id}`}
            aria-pressed={value === o.id}
            title={o.title}
            onClick={() => onChange(value === o.id && o.id !== 'all' ? 'all' : o.id)}
          >
            {o.id !== 'all' && o.id !== 'order' && <i className={`swatch swatch--${o.id}`} aria-hidden />}
            {o.label}
            <span className="count">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
