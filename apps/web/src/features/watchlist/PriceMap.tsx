import type { WatchlistRow } from '@watchlist/shared';
import { price as fp } from '../../lib/format.ts';

const W = 220;
const H = 38;
const PAD = 8;
const TRACK_Y = 17;

/**
 * Mapa de precios de una fila: rango 52 semanas, precio actual,
 * niveles de compra (triángulos), objetivo del bróker y consenso de analistas.
 */
export function PriceMap({ row }: { row: WatchlistRow }) {
  const { quote, targets, item, metrics } = row;
  const p = quote?.price;
  if (p == null) return <span className="muted">Sin cotización</span>;

  const values = [
    p,
    quote?.low52,
    quote?.high52,
    ...item.buyPrices,
    item.brokerTarget,
    targets?.mean,
    targets?.low,
    targets?.high,
  ].filter((v): v is number => v != null && Number.isFinite(v));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.1 || 1;
  const x = (v: number) => PAD + ((v - min) / span) * (W - PAD * 2);

  const lo = quote?.low52;
  const hi = quote?.high52;

  return (
    <svg
      className="price-map"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Precio ${fp(p)}; mínimo 52 semanas ${fp(lo)}, máximo ${fp(hi)}`}
    >
      {targets?.low != null && targets?.high != null && (
        <g className="pm-consensus-range">
          <line x1={x(targets.low)} x2={x(targets.high)} y1={TRACK_Y - 9} y2={TRACK_Y - 9} />
          <line x1={x(targets.low)} x2={x(targets.low)} y1={TRACK_Y - 12} y2={TRACK_Y - 6} />
          <line x1={x(targets.high)} x2={x(targets.high)} y1={TRACK_Y - 12} y2={TRACK_Y - 6} />
          <title>{`Rango de analistas: ${fp(targets.low)} – ${fp(targets.high)}`}</title>
        </g>
      )}

      {lo != null && hi != null ? (
        <line className="pm-track" x1={x(lo)} x2={x(hi)} y1={TRACK_Y} y2={TRACK_Y}>
          <title>{`Rango 52 semanas: ${fp(lo)} – ${fp(hi)}`}</title>
        </line>
      ) : (
        <line className="pm-track pm-track--unknown" x1={PAD} x2={W - PAD} y1={TRACK_Y} y2={TRACK_Y} />
      )}

      {metrics.levels.map((l, i) => {
        const cx = x(l.price);
        return (
          <g key={i} className={`pm-level pm-level--${l.status}`}>
            <path d={`M${cx} ${TRACK_Y + 4} l-5 8 h10 z`} />
            <text x={cx} y={H - 1} textAnchor="middle">
              {i + 1}
            </text>
            <title>{`Compra ${i + 1}: ${fp(l.price)}`}</title>
          </g>
        );
      })}

      {item.brokerTarget != null && (
        <g className="pm-broker">
          <rect x={x(item.brokerTarget) - 4} y={TRACK_Y - 4} width={8} height={8} transform={`rotate(45 ${x(item.brokerTarget)} ${TRACK_Y})`} />
          <title>{`Objetivo ${item.brokerName ?? 'bróker'}: ${fp(item.brokerTarget)}`}</title>
        </g>
      )}

      {targets?.mean != null && (
        <g className="pm-consensus">
          <line x1={x(targets.mean)} x2={x(targets.mean)} y1={TRACK_Y - 11} y2={TRACK_Y + 5} />
          <title>{`Consenso (media): ${fp(targets.mean)}`}</title>
        </g>
      )}

      <g className="pm-price">
        <circle cx={x(p)} cy={TRACK_Y} r={5.5} />
        <title>{`Precio actual: ${fp(p)}`}</title>
      </g>
    </svg>
  );
}

export function PriceMapLegend() {
  return (
    <div className="legend" aria-label="Leyenda del mapa de precios">
      <span><i className="lg lg-price" /> Precio actual</span>
      <span><i className="lg lg-track" /> Rango 52 sem.</span>
      <span><i className="lg lg-level" /> Niveles de compra</span>
      <span><i className="lg lg-broker" /> Objetivo bróker</span>
      <span><i className="lg lg-consensus" /> Consenso analistas (media y rango)</span>
    </div>
  );
}
