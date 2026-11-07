import type { WatchlistRow } from '@watchlist/shared';
import type { ReactNode } from 'react';
import { money, pct, price } from '../../lib/format.ts';

const name = (r: WatchlistRow) => r.item.name ?? r.quote?.name ?? r.item.symbol;

/** Lleva la vista a la fila de un valor y la resalta un momento. */
export function goToRow(id: number) {
  const el = document.getElementById(`fila-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('row--located');
  void el.getBoundingClientRect();
  el.classList.add('row--located');
}

function RowLink({ row, children }: { row: WatchlistRow; children: ReactNode }) {
  return (
    <button type="button" className="link-btn" onClick={() => goToRow(row.item.id)} title="Ir a la fila">
      {children}
    </button>
  );
}

/**
 * La línea que responde a la pregunta principal de la app: ¿qué está ya en mi precio y,
 * si nada lo está, qué es lo que más cerca está? Más las órdenes que caducan pronto.
 */
export function Highlights({ rows, base }: { rows: WatchlistRow[]; base: string }) {
  if (!rows.length) return null;
  const reached = rows.filter((r) => r.metrics.status === 'reached');
  const nearest = rows
    .filter((r) => r.metrics.status !== 'reached' && r.metrics.nearestDistancePct != null)
    .sort((a, b) => b.metrics.nearestDistancePct! - a.metrics.nearestDistancePct!)[0];
  const orders = rows.filter((r) => r.item.orderActive);
  const expiring = orders.filter((r) => r.metrics.orderDaysLeft != null && r.metrics.orderDaysLeft <= 7);
  const committed = orders.reduce((s, r) => s + (r.metrics.netBase ?? 0), 0);

  let main: ReactNode;
  if (reached.length) {
    main = (
      <p className="highlights__main highlights__main--reached">
        <strong>{reached.length === 1 ? 'En zona de compra:' : `${reached.length} valores en zona de compra:`}</strong>{' '}
        {reached.slice(0, 4).map((r, i) => {
          const lvl = r.metrics.levels.find((l) => l.status === 'reached');
          return (
            <span key={r.item.id}>
              {i > 0 && ', '}
              <RowLink row={r}>{name(r)}</RowLink>
              {lvl && (
                <span className="muted">
                  {' '}
                  ({price(r.quote?.price)} ≤ {price(lvl.price)})
                </span>
              )}
            </span>
          );
        })}
        {reached.length > 4 && <span className="muted"> y {reached.length - 4} más</span>}
      </p>
    );
  } else if (nearest) {
    const lvlIndex = nearest.metrics.levels.findIndex((l) => l.distancePct === nearest.metrics.nearestDistancePct);
    const lvl = nearest.metrics.levels[lvlIndex];
    main = (
      <p className="highlights__main">
        <strong>Nada en zona de compra.</strong> Lo más cerca: <RowLink row={nearest}>{name(nearest)}</RowLink>, le falta
        caer un {pct(Math.abs(nearest.metrics.nearestDistancePct!)).replace('+', '')} hasta su compra {lvlIndex + 1}
        {lvl && <> ({price(lvl.price)})</>}.
      </p>
    );
  } else {
    main = <p className="highlights__main">Ningún valor tiene precios de compra todavía. Añádelos con el lápiz de cada fila.</p>;
  }

  return (
    <section className="highlights" aria-label="Lo más importante">
      {main}
      {orders.length > 0 && (
        <p className="highlights__side">
          {orders.length === 1 ? '1 orden activa' : `${orders.length} órdenes activas`} · {money(committed, base)}
          {expiring.map((r) => (
            <span key={r.item.id} className="highlights__warn">
              {' · '}
              <RowLink row={r}>{name(r)}</RowLink>{' '}
              {r.metrics.orderExpired
                ? 'caducada'
                : r.metrics.orderDaysLeft === 0
                  ? 'caduca hoy'
                  : `caduca en ${r.metrics.orderDaysLeft} d`}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
