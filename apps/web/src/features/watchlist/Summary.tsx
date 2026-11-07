import type { WatchlistRow } from '@watchlist/shared';
import { money } from '../../lib/format.ts';

export type Filter = 'all' | 'reached' | 'near' | 'order';

export const filterRow = (f: Filter) => (r: WatchlistRow) =>
  f === 'all' ? true : f === 'order' ? r.item.orderActive : r.metrics.status === f;

interface Props {
  rows: WatchlistRow[];
  base: string;
  nearPct: number;
  filter: Filter;
  onFilter: (f: Filter) => void;
}

/** Tarjetas-resumen que además funcionan como filtros rápidos. */
export function Summary({ rows, base, nearPct, filter, onFilter }: Props) {
  const reached = rows.filter(filterRow('reached')).length;
  const near = rows.filter(filterRow('near')).length;
  const orders = rows.filter(filterRow('order'));
  const expiring = orders.filter((r) => r.metrics.orderDaysLeft != null && r.metrics.orderDaysLeft <= 7).length;
  const committed = orders.reduce((s, r) => s + (r.metrics.netBase ?? 0), 0);

  const cards: { id: Filter; label: string; value: string; hint: string }[] = [
    { id: 'all', label: 'Valores', value: String(rows.length), hint: 'en esta lista' },
    { id: 'reached', label: 'En zona de compra', value: String(reached), hint: 'precio ≤ algún nivel' },
    { id: 'near', label: 'Cerca', value: String(near), hint: `a menos de ${nearPct} %` },
    {
      id: 'order',
      label: 'Órdenes activas',
      value: String(orders.length),
      hint: orders.length
        ? `${money(committed, base)}${expiring ? ` · ${expiring} vence${expiring > 1 ? 'n' : ''} en ≤ 7 d` : ''}`
        : 'ninguna',
    },
  ];

  return (
    <div className="summary" role="group" aria-label="Filtros rápidos">
      {cards.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`card card--${c.id}${filter === c.id ? ' card--active' : ''}`}
          aria-pressed={filter === c.id}
          onClick={() => onFilter(filter === c.id ? 'all' : c.id)}
        >
          <span className="card__label">{c.label}</span>
          <span className="card__value">{c.value}</span>
          <span className="card__hint">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}
