import type { WatchlistRow } from '@watchlist/shared';
import { pct, price as fp } from '../../lib/format.ts';

const W = 240;
const H = 46;
const PAD = 10;
const MID = 23; // eje horizontal de la barra

/**
 * Mapa de precios de una fila, leído de izquierda (barato) a derecha (caro):
 *  - franja sombreada: la zona de compra (todo lo que queda por debajo de tu compra más alta),
 *  - banda gris: el rango de las últimas 52 semanas, con sus extremos anotados debajo,
 *  - marcas 1·2·3: tus niveles de compra (color según su estado),
 *  - marcas de objetivo: bróker (sólida) y consenso de analistas (discontinua),
 *  - aguja: el precio actual.
 * Así se ve de un vistazo si el precio está dentro de la zona o cuánto le falta.
 */
export function PriceMap({ row }: { row: WatchlistRow }) {
  const { quote, targets, item, metrics } = row;
  const p = quote?.price;
  if (p == null) return <span className="muted small">Sin cotización</span>;

  const lo = quote?.low52 ?? null;
  const hi = quote?.high52 ?? null;
  const consensus = targets?.mean ?? null;
  const values = [p, lo, hi, ...item.buyPrices, item.brokerTarget, consensus].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || rawMax * 0.1 || 1;
  const zoneTop = item.buyPrices.length ? Math.max(...item.buyPrices) : null;
  // La zona de compra siempre ocupa al menos un 12 % del ancho, aunque tu nivel sea el precio más bajo.
  const min = Math.min(rawMin - span * 0.04, zoneTop != null ? zoneTop - span * 0.12 : Infinity);
  const max = rawMax + span * 0.04;
  const x = (v: number) => PAD + ((v - min) / (max - min)) * (W - PAD * 2);
  const inZone = metrics.status === 'reached';

  const summary = [
    `Precio ${fp(p)}`,
    ...metrics.levels.map((l, i) => `Compra ${i + 1}: ${fp(l.price)} (${pct(l.distancePct)})`),
    item.brokerTarget != null ? `Objetivo ${item.brokerName ?? 'bróker'}: ${fp(item.brokerTarget)} (${pct(metrics.upsideBrokerPct)})` : null,
    consensus != null ? `Consenso: ${fp(consensus)} (${pct(metrics.upsideConsensusPct)})` : null,
    lo != null && hi != null ? `Rango 52 semanas: ${fp(lo)} a ${fp(hi)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const showRangeLabels = lo != null && hi != null && x(hi) - x(lo) > 70;

  return (
    <svg className={`price-map${inZone ? ' price-map--in-zone' : ''}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary.replace(/\n/g, '. ')}>
      <title>{summary}</title>

      {/* Zona de compra: desde la izquierda hasta tu compra más alta */}
      {zoneTop != null && <rect className="pm-zone" x={PAD} y={MID - 8} width={Math.max(0, x(zoneTop) - PAD)} height={16} rx={2} />}

      {/* Eje y rango de 52 semanas */}
      <line className="pm-axis" x1={PAD} x2={W - PAD} y1={MID} y2={MID} />
      {lo != null && hi != null && <line className="pm-range" x1={x(lo)} x2={x(hi)} y1={MID} y2={MID} />}
      {showRangeLabels && (
        <>
          <text className="pm-label" x={x(lo!)} y={H - 2} textAnchor="start">
            {fp(lo)}
          </text>
          <text className="pm-label" x={x(hi!)} y={H - 2} textAnchor="end">
            {fp(hi)}
          </text>
        </>
      )}

      {/* Objetivos */}
      {consensus != null && <line className="pm-consensus" x1={x(consensus)} x2={x(consensus)} y1={MID - 9} y2={MID + 9} />}
      {item.brokerTarget != null && (
        <line className="pm-broker" x1={x(item.brokerTarget)} x2={x(item.brokerTarget)} y1={MID - 9} y2={MID + 9} />
      )}

      {/* Niveles de compra */}
      {metrics.levels.map((l, i) => (
        <g key={i} className={`pm-level pm-level--${l.status}`}>
          <line x1={x(l.price)} x2={x(l.price)} y1={MID - 8} y2={MID + 8} />
          <text x={x(l.price)} y={MID - 11} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}

      {/* Precio actual */}
      <line className="pm-price" x1={x(p)} x2={x(p)} y1={MID - 11} y2={MID + 11} />
    </svg>
  );
}

export function PriceMapLegend() {
  return (
    <div className="legend" aria-label="Leyenda del mapa de precios">
      <span><i className="lg lg-price" /> Precio</span>
      <span><i className="lg lg-zone" /> Zona de compra</span>
      <span><i className="lg lg-level" /> Niveles 1·2·3</span>
      <span><i className="lg lg-track" /> Rango 52 sem.</span>
      <span><i className="lg lg-broker" /> Obj. bróker</span>
      <span><i className="lg lg-consensus" /> Consenso</span>
    </div>
  );
}
