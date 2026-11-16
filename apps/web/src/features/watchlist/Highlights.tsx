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
  const orders = rows.filter((r) => r.item.orderActive);
  const committed = orders.reduce((s, r) => s + (r.metrics.netBase ?? 0), 0);
  const earnings = rows
    .map((r) => ({ r, d: upcoming(r).find((k) => k.kind === 'earnings' && k.days <= 7) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d!.days - b.d!.days);

  // Distancia hasta un precio, como en la tabla: −0,6 % = le falta bajar un 0,6 %.
  const dist = (v: number) => pct(Math.abs(v)).replace('+', '−');
  const near = rows
    .filter((r) => r.metrics.status !== 'reached' && r.metrics.nearestDistancePct != null)
    .sort((a, b) => b.metrics.nearestDistancePct! - a.metrics.nearestDistancePct!)
    .slice(0, 4);

  let main: ReactNode;
  if (reached.length) {
    main = (
      <Cell wide label={<span className="hl-label--reached">En zona de compra · {reached.length}</span>}>
        <ul className="hl-rows">
          {reached.slice(0, 4).map((r) => {
            const lvlIndex = r.metrics.levels.findIndex((l) => l.status === 'reached');
            const lvl = r.metrics.levels[lvlIndex];
            return (
              <li key={r.item.id}>
                <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
                <span className="hl-rows__detail">{lvl && <>compra {lvlIndex + 1} · <span className="num">{price(lvl.price, r.quote?.currency)}</span></>}</span>
                <span className="hl-rows__fig num hl-dist--reached">{price(r.quote?.price, r.quote?.currency)}</span>
              </li>
            );
          })}
          {reached.length > 4 && <li className="hl-rows__more">y {reached.length - 4} más</li>}
        </ul>
      </Cell>
    );
  } else if (near.length) {
    main = (
      <Cell wide label="Lo más cerca de tus precios de compra">
        <ul className="hl-rows hl-rows--ranked">
          {near.map((r) => {
            const lvlIndex = r.metrics.levels.findIndex((l) => l.distancePct === r.metrics.nearestDistancePct);
            const lvl = r.metrics.levels[lvlIndex];
            return (
              <li key={r.item.id}>
                <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
                <span className="hl-rows__detail">{lvl && <>compra {lvlIndex + 1} · <span className="num">{price(lvl.price, r.quote?.currency)}</span></>}</span>
                <span className={`hl-rows__fig num hl-dist--${lvl?.status ?? 'unknown'}`} title={`Le falta bajar un ${dist(r.metrics.nearestDistancePct!).slice(1)}`}>
                  {dist(r.metrics.nearestDistancePct!)}
                </span>
              </li>
            );
          })}
        </ul>
      </Cell>
    );
  } else {
    main = (
      <Cell wide label="Precios de compra">
        <p className="hl-value">Abre un valor para añadir sus precios de compra.</p>
      </Cell>
    );
  }

  const expiry = (r: WatchlistRow) => {
    const d = r.metrics.orderDaysLeft;
    if (d == null) return <span className="hl-chip">sin fecha</span>;
    const text = d < 0 ? 'caducada' : d === 0 ? 'caduca hoy' : d === 1 ? 'caduca mañana' : `${d} d`;
    return <span className={`hl-chip${d <= 1 ? ' hl-chip--warn' : ''}`}>{text}</span>;
  };
  const ordersSorted = [...orders].sort((a, b) => (a.metrics.orderDaysLeft ?? 1e9) - (b.metrics.orderDaysLeft ?? 1e9));

  const summary = reached.length
    ? `${reached.length} en zona de compra`
    : near[0]
      ? `${dist(near[0].metrics.nearestDistancePct!)} hasta comprar`
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
          <Cell
            label={
              <>
                Órdenes activas · {orders.length} <span className="hl-label__aside num">{money(committed, base)}</span>
              </>
            }
          >
            {/* Se nombran todas: así se ve cuál es aunque la tabla esté filtrada y no la muestre. Primero las que caducan antes. */}
            <ul className="hl-rows">
              {ordersSorted.slice(0, 4).map((r) => (
                <li key={r.item.id}>
                  <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
                  <span className="hl-rows__detail num">{r.item.orderPrice != null && price(r.item.orderPrice, r.quote?.currency)}</span>
                  {expiry(r)}
                </li>
              ))}
              {orders.length > 4 && <li className="hl-rows__more">y {orders.length - 4} más</li>}
            </ul>
          </Cell>
        )}
        {earnings.length > 0 && (
          <Cell label="Resultados esta semana">
            <ul className="hl-rows hl-rows--two">
              {earnings.slice(0, 4).map(({ r, d }) => (
                <li key={r.item.id}>
                  <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
                  <span className={`hl-chip${d!.days <= 1 ? ' hl-chip--info' : ''}`}>{when(d!.days)}</span>
                </li>
              ))}
              {earnings.length > 4 && <li className="hl-rows__more">y {earnings.length - 4} más</li>}
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
