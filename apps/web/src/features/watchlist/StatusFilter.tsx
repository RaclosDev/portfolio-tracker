import type { WatchlistRow } from '@watchlist/shared';

export type Filter = 'all' | 'reached' | 'near' | 'far' | 'veryFar' | 'order';

export const filterRow = (f: Filter) => (r: WatchlistRow) =>
  f === 'all' ? true : f === 'order' ? r.item.orderActive : r.metrics.status === f;

const OPTIONS: { id: Filter; label: string; title: (near: string, far: string) => string }[] = [
  { id: 'all', label: 'Todos', title: () => 'Todos los valores de la lista' },
  { id: 'reached', label: 'En zona', title: () => 'El precio ya está por debajo de alguno de tus niveles de compra' },
  { id: 'near', label: 'Cerca', title: (n) => `Le falta caer como mucho un ${n} % hasta un nivel` },
  { id: 'far', label: 'Lejos', title: (n, f) => `Le falta caer entre un ${n} % y un ${f} %` },
  { id: 'veryFar', label: 'Muy lejos', title: (_n, f) => `Le falta caer más de un ${f} %` },
  { id: 'order', label: 'Con orden', title: () => 'Tienes una orden de compra puesta en el banco' },
];

const fmt = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });

interface Props {
  rows: WatchlistRow[];
  nearPct: number;
  farPct: number;
  value: Filter;
  onChange: (f: Filter) => void;
}

/** Filtro por estado con el recuento de cada uno (sustituye a las tarjetas de resumen). */
export function StatusFilter({ rows, nearPct, farPct, value, onChange }: Props) {
  return (
    <div className="segmented status-filter" role="group" aria-label="Filtrar por estado">
      {OPTIONS.map((o) => {
        const n = rows.filter(filterRow(o.id)).length;
        return (
          <button
            key={o.id}
            type="button"
            className={`${value === o.id ? 'on' : ''} seg--${o.id}`}
            aria-pressed={value === o.id}
            title={o.title(fmt(nearPct), fmt(farPct))}
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
