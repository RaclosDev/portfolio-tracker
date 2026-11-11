import type { WatchlistRow } from '@watchlist/shared';
import { useState, type ReactNode } from 'react';
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

function RowLink({ row, children, full, onLocate }: { row: WatchlistRow; children: ReactNode; full?: boolean; onLocate: (id: number) => void }) {
  return (
    <button type="button" className="link-btn" onClick={() => onLocate(row.item.id)} title={full ? 'Ir a la fila' : `${name(row)} · ir a la fila`}>
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
export function Highlights({ rows, base, onLocate, quoteInfo }: {
  rows: WatchlistRow[];
  base: string;
  onLocate: (id: number) => void;
  quoteInfo: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
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
                <RowLink row={r} onLocate={onLocate} full>
                  {name(r)}
                </RowLink>
                {lvl && (
                  <span className="muted num">
                    {' '}
                    {price(r.quote?.price, r.quote?.currency)} ≤ {price(lvl.price, r.quote?.currency)}
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
            <RowLink row={nearest} onLocate={onLocate} full>
              {name(nearest)}
            </RowLink>
            <span className="muted">
              {' '}
              hasta su compra {lvlIndex + 1}
              {lvl && <span className="num"> ({price(lvl.price, nearest.quote?.currency)})</span>}
            </span>
          </span>
        </p>
      </Cell>
    );
  } else {
    main = (
      <Cell wide label="Precios de compra">
        <p className="hl-value">Abre un valor para añadir sus precios de compra.</p>
      </Cell>
    );
  }

  const summary = reached.length
    ? `${reached.length} en zona de compra`
    : nearest
      ? `${pct(Math.abs(nearest.metrics.nearestDistancePct!)).replace('+', '−')} hasta comprar`
      : 'Sin precios de compra';

  return (
    <>
      <button
        type="button"
        className="highlights-toggle"
        aria-expanded={expanded}
        aria-controls="watchlist-highlights"
        onClick={() => setExpanded((open) => !open)}
      >
        <span><strong>Resumen</strong>{orders.length > 0 && ` · ${orders.length} ${orders.length === 1 ? 'orden' : 'órdenes'}`} · {summary}</span>
        <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>
      <section id="watchlist-highlights" className={`highlights${expanded ? ' highlights--open' : ''}`} aria-label="Resumen">
        {main}
        {orders.length > 0 && (
          <Cell label="Órdenes activas">
            <p className="hl-value">
              <strong className="num">{orders.length}</strong> <span className="muted">·</span>{' '}
              <span className="num">{money(committed, base)}</span>
            </p>
            {/* Se nombran todas: así se ve cuál es aunque la tabla esté filtrada y no la muestre. */}
            {[...expiring, ...orders.filter((r) => !expiring.includes(r))].slice(0, 4).map((r) => (
              <p key={r.item.id} className={expiring.includes(r) ? 'hl-warn' : 'small'}>
                <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
                {expiring.includes(r) &&
                  ` ${r.metrics.orderExpired ? 'caducada' : r.metrics.orderDaysLeft === 0 ? 'caduca hoy' : `caduca en ${r.metrics.orderDaysLeft} d`}`}
              </p>
            ))}
            {orders.length > 4 && <p className="muted small">y {orders.length - 4} más</p>}
          </Cell>
        )}
        {earnings.length > 0 && (
          <Cell label="Resultados en 7 días">
            <ul className="hl-inline">
              {earnings.slice(0, 5).map(({ r, d }) => (
                <li key={r.item.id}>
                  <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink> <span className="muted">{when(d!.days)}</span>
                </li>
              ))}
              {earnings.length > 5 && <li className="muted">y {earnings.length - 5} más</li>}
            </ul>
          </Cell>
        )}
        <div className="highlights-quotes hl-cell hl-cell--full">
          <p className="hl-label">Cotizaciones</p>
          <div className="highlights-quotes__data">{quoteInfo}</div>
        </div>
      </section>
    </>
  );
}
