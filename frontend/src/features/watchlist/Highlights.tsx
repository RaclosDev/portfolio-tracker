import type { WatchlistRow } from '@/shared';
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

/** Grupo de la franja: rótulo y valores en línea, con «y N más» si no caben. */
function Group({ label, tone, items, max = 4 }: { label: ReactNode; tone?: string; items: ReactNode[]; max?: number }) {
  if (!items.length) return null;
  return (
    <div className={`hl-group${tone ? ` hl-group--${tone}` : ''}`}>
      <span className="hl-group__label">{label}</span>
      <ul className="hl-items">
        {items.slice(0, max)}
        {items.length > max && <li className="hl-items__more">y {items.length - max} más</li>}
      </ul>
    </div>
  );
}

/** Órdenes que se avisan en el resumen: caducadas o que caducan en estos días (el resto se ve en la tabla). */
const ORDER_WARN_DAYS = 3;

/**
 * Franja de avisos encima de la tabla: solo lo que pide hacer algo. Valores en zona de compra o muy cerca
 * (según las bandas del usuario), órdenes a punto de caducar y resultados de la semana (días en que el
 * precio suele moverse mucho). Si no hay nada, no ocupa sitio: lo demás ya está en la tabla.
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
  const urgentOrders = orders
    .filter((r) => r.metrics.orderDaysLeft != null && r.metrics.orderDaysLeft <= ORDER_WARN_DAYS)
    .sort((a, b) => a.metrics.orderDaysLeft! - b.metrics.orderDaysLeft!);
  const earnings = rows
    .map((r) => ({ r, d: upcoming(r).find((k) => k.kind === 'earnings' && k.days <= 7) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d!.days - b.d!.days);

  // Distancia hasta un precio, como en la tabla: −0,6 % = le falta bajar un 0,6 %.
  const dist = (v: number) => pct(Math.abs(v)).replace('+', '−');
  const nearest = (r: WatchlistRow) => r.metrics.levels.findIndex((l) => l.distancePct === r.metrics.nearestDistancePct);
  const veryNear = rows
    .filter((r) => r.metrics.status !== 'reached' && r.metrics.nearestDistancePct != null && r.metrics.levels[nearest(r)]?.status === 'veryNear')
    .sort((a, b) => b.metrics.nearestDistancePct! - a.metrics.nearestDistancePct!);

  const reachedItems = reached.map((r) => {
    const i = r.metrics.levels.findIndex((l) => l.status === 'reached');
    const lvl = r.metrics.levels[i];
    return (
      <li key={r.item.id} title={lvl ? `Compra ${i + 1} · ${price(lvl.price, r.quote?.currency)}` : undefined}>
        <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
        <span className="hl-items__fig num hl-dist--reached">{price(r.quote?.price, r.quote?.currency)}</span>
      </li>
    );
  });
  const nearItems = veryNear.map((r) => {
    const i = nearest(r);
    const lvl = r.metrics.levels[i];
    const d = dist(r.metrics.nearestDistancePct!);
    return (
      <li key={r.item.id} title={lvl ? `Compra ${i + 1} · ${price(lvl.price, r.quote?.currency)} · le falta bajar un ${d.slice(1)}` : undefined}>
        <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
        <span className="hl-items__fig num hl-dist--veryNear">{d}</span>
      </li>
    );
  });
  const orderItems = urgentOrders.map((r) => {
    const d = r.metrics.orderDaysLeft!;
    const text = d < 0 ? 'caducada' : d === 0 ? 'caduca hoy' : d === 1 ? 'caduca mañana' : `caduca en ${d} d`;
    return (
      <li key={r.item.id} title={r.item.orderPrice != null ? `Orden a ${price(r.item.orderPrice, r.quote?.currency)}` : undefined}>
        <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
        <span className={`hl-chip${d <= 1 ? ' hl-chip--warn' : ''}`}>{text}</span>
      </li>
    );
  });
  const earningItems = earnings.map(({ r, d }) => (
    <li key={r.item.id}>
      <RowLink row={r} onLocate={onLocate}>{shortName(r)}</RowLink>
      <span className={`hl-chip${d!.days <= 1 ? ' hl-chip--info' : ''}`}>{when(d!.days)}</span>
    </li>
  ));
  const empty = !reachedItems.length && !nearItems.length && !orderItems.length && !earningItems.length;

  const summary = [
    reached.length ? `${reached.length} en zona de compra` : nearItems.length ? `${nearItems.length} muy cerca` : null,
    orderItems.length ? `${orderItems.length} ${orderItems.length === 1 ? 'orden caduca' : 'órdenes caducan'} pronto` : null,
    earningItems.length ? `${earningItems.length} con resultados` : null,
  ].filter(Boolean).join(' · ') || 'Nada que vigilar ahora';

  return (
    <>
      <button
        type="button"
        className="highlights-toggle"
        aria-expanded={expanded}
        aria-controls="watchlist-highlights"
        onClick={() => setExpanded((open) => !open)}
      >
        <span><strong>Resumen</strong> · {summary}</span>
        <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>
      <section id="watchlist-highlights" className={`hl-strip${expanded ? ' highlights--open' : ''}${empty ? ' hl-strip--empty' : ''}`} aria-label="Resumen">
        <Group label={`En zona de compra · ${reached.length}`} tone="reached" items={reachedItems} />
        <Group label="Muy cerca" items={nearItems} />
        <Group
          label={<>Órdenes <span className="num" title={`${orders.length} activas · ${money(committed, base)}`}>({orders.length})</span></>}
          items={orderItems}
        />
        <Group label="Resultados" items={earningItems} />
        <div className="highlights-quotes hl-group hl-group--full">
          <span className="hl-group__label">Cotizaciones</span>
          <div className="highlights-quotes__data">{quoteInfo}</div>
        </div>
      </section>
    </>
  );
}
