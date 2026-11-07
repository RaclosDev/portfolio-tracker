import type { WatchlistRow } from '@watchlist/shared';
import { money } from '../../lib/format.ts';

export type Filter = 'all' | 'reached' | 'near' | 'far' | 'veryFar' | 'order';

export const filterRow = (f: Filter) => (r: WatchlistRow) =>
  f === 'all' ? true : f === 'order' ? r.item.orderActive : r.metrics.status === f;

interface Props {
  rows: WatchlistRow[];
  base: string;
  nearPct: number;
  farPct: number;
  filter: Filter;
  onFilter: (f: Filter) => void;
}

const fmtPct = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** Tarjetas-resumen que además funcionan como filtros rápidos. */
export function Summary({ rows, base, nearPct, farPct, filter, onFilter }: Props) {
  const count = (f: Filter) => rows.filter(filterRow(f)).length;
  const orders = rows.filter(filterRow('order'));
  const expiring = orders.filter((r) => r.metrics.orderDaysLeft != null && r.metrics.orderDaysLeft <= 7).length;
  const committed = orders.reduce((s, r) => s + (r.metrics.netBase ?? 0), 0);

  const cards: { id: Filter; label: string; value: number; hint: string }[] = [
    { id: 'all', label: 'Valores', value: rows.length, hint: 'en esta lista' },
    { id: 'reached', label: 'En zona de compra', value: count('reached'), hint: 'precio ≤ algún nivel' },
    { id: 'near', label: 'Cerca', value: count('near'), hint: `le falta caer ≤ ${fmtPct(nearPct)} %` },
    { id: 'far', label: 'Lejos', value: count('far'), hint: `≤ ${fmtPct(farPct)} %` },
    { id: 'veryFar', label: 'Muy lejos', value: count('veryFar'), hint: `más del ${fmtPct(farPct)} %` },
    {
      id: 'order',
      label: 'Órdenes activas',
      value: orders.length,
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
          className={`card card--${c.id}${filter === c.id ? ' card--active' : ''}${c.id === 'reached' && c.value > 0 ? ' card--alert' : ''}`}
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
