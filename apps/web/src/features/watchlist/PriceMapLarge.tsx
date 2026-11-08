import { DEFAULT_STATUS_NAMES, type LevelStatus, type WatchlistRow } from '@watchlist/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '../../api/hooks.ts';
import { pct, price as fp } from '../../lib/format.ts';

const PAD = 14;
const LANE = 20; // alto de cada fila de rótulos
const AXIS_BLOCK = 44; // alto de la zona del eje (marcas incluidas)
const CHAR = 7.4; // ancho medio de un carácter a 13 px

interface Label {
  x: number;
  text: string;
  cls: string;
  lane?: number;
  left?: number;
  w?: number;
}

/** Coloca cada rótulo en la primera fila libre para que no se pisen (de arriba abajo o al revés). */
function placeLabels(labels: Label[], width: number, maxLanes = 4) {
  const lanes: [number, number][][] = [];
  for (const l of labels) {
    const w = l.text.length * CHAR + 10;
    const left = Math.min(Math.max(l.x - w / 2, 0), width - w);
    let lane = 0;
    while (lane < maxLanes - 1 && (lanes[lane] ?? []).some(([a, b]) => left < b + 6 && left + w > a - 6)) lane++;
    (lanes[lane] ??= []).push([left, left + w]);
    Object.assign(l, { lane, left, w });
  }
  return lanes.length;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Mapa de precios a lo ancho, con todo rotulado: arriba tus compras (con el color de su estado),
 * abajo el precio actual, los objetivos y el rango de 52 semanas. Misma lectura que el de la tabla:
 * a la izquierda barato, a la derecha caro; la franja verde es la zona de compra.
 */
export function PriceMapLarge({ row }: { row: WatchlistRow }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const { quote, targets, item, metrics } = row;
  const p = quote?.price;

  if (p == null) return <p className="muted">Sin cotización ahora mismo.</p>;

  const lo = quote?.low52 ?? null;
  const hi = quote?.high52 ?? null;
  const consensus = targets?.mean ?? null;
  const values = [p, lo, hi, ...item.buyPrices, item.brokerTarget, consensus, item.orderActive ? item.orderPrice : null].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || rawMax * 0.1 || 1;
  const zoneTop = item.buyPrices.length ? Math.max(...item.buyPrices) : null;
  const min = Math.min(rawMin - span * 0.05, zoneTop != null ? zoneTop - span * 0.1 : Infinity);
  const max = rawMax + span * 0.05;
  const x = (v: number) => PAD + ((v - min) / (max - min)) * (Math.max(W, 200) - PAD * 2);

  // Arriba: tus niveles de compra (y la orden, si la hay).
  const top: (Label & { status?: LevelStatus })[] = metrics.levels.map((l, i) => ({
    x: x(l.price),
    text: `${i + 1} · ${fp(l.price)} (${pct(l.distancePct)})`,
    cls: `pm-level--${l.status}`,
    status: l.status,
  }));
  if (item.orderActive && item.orderPrice) top.push({ x: x(item.orderPrice), text: `Orden ${fp(item.orderPrice)}`, cls: 'pmL-order' });

  // Abajo: precio (siempre en la primera fila), objetivos y extremos del año.
  const bottom: Label[] = [{ x: x(p), text: `Precio ${fp(p)}`, cls: 'pmL-price' }];
  if (item.brokerTarget != null)
    bottom.push({ x: x(item.brokerTarget), text: `${item.brokerName ?? 'Bróker'} ${fp(item.brokerTarget)}`, cls: 'pmL-broker' });
  if (consensus != null) bottom.push({ x: x(consensus), text: `Consenso ${fp(consensus)}`, cls: 'pmL-consensus' });
  if (lo != null) bottom.push({ x: x(lo), text: `Mín. año ${fp(lo)}`, cls: 'pmL-range' });
  if (hi != null) bottom.push({ x: x(hi), text: `Máx. año ${fp(hi)}`, cls: 'pmL-range' });

  const w = Math.max(W, 200);
  const topLanes = Math.max(1, placeLabels(top, w));
  const bottomLanes = placeLabels(bottom, w);
  const axisY = topLanes * LANE + AXIS_BLOCK / 2 + 4;
  const H = axisY + AXIS_BLOCK / 2 + bottomLanes * LANE + 4;
  const labelTopY = (lane: number) => (topLanes - lane) * LANE - 6;
  const labelBottomY = (lane: number) => axisY + AXIS_BLOCK / 2 + (lane + 1) * LANE - 6;
  const tick = 13;

  const summary = [
    `Precio ${fp(p)}`,
    ...metrics.levels.map((l, i) => `Compra ${i + 1}: ${fp(l.price)}, ${pct(l.distancePct)}, ${l.status !== 'unknown' ? names[l.status] : ''}`),
    item.brokerTarget != null ? `Objetivo ${item.brokerName ?? 'bróker'}: ${fp(item.brokerTarget)}` : null,
    consensus != null ? `Consenso: ${fp(consensus)}` : null,
    lo != null && hi != null ? `Rango del último año: ${fp(lo)} a ${fp(hi)}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <div ref={ref} className="pm-large">
      {W > 0 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={summary} className="price-map">
          {zoneTop != null && (
            <>
              <rect className={`pm-zone${metrics.status === 'reached' ? ' pm-zone--in' : ''}`} x={PAD} y={axisY - 14} width={Math.max(0, x(zoneTop) - PAD)} height={28} rx={3} />
            </>
          )}
          <line className="pm-axis" x1={PAD} x2={w - PAD} y1={axisY} y2={axisY} />
          {lo != null && hi != null && <line className="pm-range pm-range--large" x1={x(lo)} x2={x(hi)} y1={axisY} y2={axisY} />}

          {consensus != null && <line className="pm-consensus" x1={x(consensus)} x2={x(consensus)} y1={axisY - tick} y2={axisY + tick} />}
          {item.brokerTarget != null && (
            <line className="pm-broker" x1={x(item.brokerTarget)} x2={x(item.brokerTarget)} y1={axisY - tick} y2={axisY + tick} />
          )}
          {item.orderActive && item.orderPrice != null && (
            <line className="pmL-order-line" x1={x(item.orderPrice)} x2={x(item.orderPrice)} y1={axisY - tick} y2={axisY + tick} />
          )}

          {/* Rótulos de arriba con su guía hasta la marca */}
          {top.map((l, i) => (
            <g key={`t${i}`} className={`pm-level ${l.cls}`}>
              <line className="pmL-guide" x1={l.x} x2={l.x} y1={labelTopY(l.lane!) + 4} y2={axisY - tick} />
              <line x1={l.x} x2={l.x} y1={axisY - tick} y2={axisY + tick} />
              <text x={l.left! + l.w! / 2} y={labelTopY(l.lane!)} textAnchor="middle" className="pmL-text">
                {l.text}
              </text>
            </g>
          ))}

          {/* Precio actual */}
          <line className="pm-price" x1={x(p)} x2={x(p)} y1={axisY - tick - 3} y2={axisY + tick + 3} />

          {/* Rótulos de abajo */}
          {bottom.map((l, i) => (
            <g key={`b${i}`} className={l.cls}>
              {l.lane! > 0 && <line className="pmL-guide" x1={l.x} x2={l.x} y1={axisY + tick} y2={labelBottomY(l.lane!) - 12} />}
              <text x={l.left! + l.w! / 2} y={labelBottomY(l.lane!)} textAnchor="middle" className="pmL-text">
                {l.text}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
