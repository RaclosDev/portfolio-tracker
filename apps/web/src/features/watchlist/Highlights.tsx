import type { WatchlistRow } from '@watchlist/shared';
import type { ReactNode } from 'react';
import { money, pct, price } from '../../lib/format.ts';
import { upcoming } from '../../lib/keyDates.ts';

const name = (r: WatchlistRow) => r.item.name ?? r.quote?.name ?? r.item.symbol;

/** Nombre corto para las listas del resumen: sin la forma jurídica («Colonial SFL, Socimi S. A.» → «Colonial SFL»). */
const shortName = (r: WatchlistRow) =>
  name(r)
    .split(',')[0]!
    .replace(/\s+(S\.?\s?A\.?|N\.?V\.?|Inc\.?|Corp\.?|Corporation|plc|PLC|AG|SE|SOCIMI)$/i, '')
    .trim();

const when = (days: number) => (days <= 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} d`);

/** Lleva la vista a la fila de un valor y la resalta un momento. */
export function goToRow(id: number) {
  const el = document.getElementById(`fila-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('row--located');
  void el.getBoundingClientRect();
  el.classList.add('row--located');
}

function RowLink({ row, children, full }: { row: WatchlistRow; children: ReactNode; full?: boolean }) {
  return (
    <button type="button" className="link-btn" onClick={() => goToRow(row.item.id)} title={full ? 'Ir a la fila' : `${name(row)} · ir a la fila`}>
      {children}
    </button>
  );
}

function Cell({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`hl-cell${wide ? ' hl-cell--main' : ''}`}>
      <p className="hl-label">{label}</p>
      {children}
    </div>
  );
}

/**
 * Resumen encima de la tabla. El primer bloque responde a la pregunta de la app: ¿qué está ya en mi
 * precio o, si nada, qué es lo que más cerca está? Al lado, las órdenes puestas y los resultados de
 * la semana (días en que el precio suele moverse mucho).
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
  const earnings = rows
    .map((r) => ({ r, d: upcoming(r).find((k) => k.kind === 'earnings' && k.days <= 7) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d!.days - b.d!.days);

  let main: ReactNode;
  if (reached.length) {
    main = (
      <Cell wide label={<span className="hl-label--reached">En zona de compra · {reached.length}</span>}>
        <ul className="hl-list">
          {reached.slice(0, 4).map((r) => {
            const lvl = r.metrics.levels.find((l) => l.status === 'reached');
            return (
              <li key={r.item.id}>
                <RowLink row={r} full>
                  {name(r)}
                </RowLink>
                {lvl && (
                  <span className="muted num">
                    {' '}
                    {price(r.quote?.price)} ≤ {price(lvl.price)}
                  </span>
                )}
              </li>
            );
          })}
          {reached.length > 4 && <li className="muted">y {reached.length - 4} más</li>}
        </ul>
      </Cell>
    );
  } else if (nearest) {
    const lvlIndex = nearest.metrics.levels.findIndex((l) => l.distancePct === nearest.metrics.nearestDistancePct);
    const lvl = nearest.metrics.levels[lvlIndex];
    main = (
      <Cell wide label="Nada en zona de compra · lo más cerca">
        <p className="hl-nearest">
          <span className={`hl-big num hl-dist--${lvl?.status ?? 'unknown'}`}>
            {pct(Math.abs(nearest.metrics.nearestDistancePct!)).replace('+', '−')}
          </span>
          <span className="hl-nearest__what">
            <RowLink row={nearest} full>
              {name(nearest)}
            </RowLink>
            <span className="muted">
              {' '}
              hasta su compra {lvlIndex + 1}
              {lvl && <span className="num"> ({price(lvl.price)})</span>}
            </span>
          </span>
        </p>
      </Cell>
    );
  } else {
    main = (
      <Cell wide label="Precios de compra">
        <p className="hl-value">Ningún valor tiene todavía. Añádelos con el lápiz de cada fila.</p>
      </Cell>
    );
  }

  return (
    <section className="highlights" aria-label="Resumen">
      {main}
      {orders.length > 0 && (
        <Cell label="Órdenes activas">
          <p className="hl-value">
            <strong className="num">{orders.length}</strong> <span className="muted">·</span>{' '}
            <span className="num">{money(committed, base)}</span>
          </p>
          {expiring.map((r) => (
            <p key={r.item.id} className="hl-warn">
              <RowLink row={r}>{shortName(r)}</RowLink>{' '}
              {r.metrics.orderExpired ? 'caducada' : r.metrics.orderDaysLeft === 0 ? 'caduca hoy' : `caduca en ${r.metrics.orderDaysLeft} d`}
            </p>
          ))}
        </Cell>
      )}
      {earnings.length > 0 && (
        <Cell label="Resultados en 7 días">
          <ul className="hl-inline">
            {earnings.slice(0, 5).map(({ r, d }) => (
              <li key={r.item.id}>
                <RowLink row={r}>{shortName(r)}</RowLink> <span className="muted">{when(d!.days)}</span>
              </li>
            ))}
            {earnings.length > 5 && <li className="muted">y {earnings.length - 5} más</li>}
          </ul>
        </Cell>
      )}
    </section>
  );
}
