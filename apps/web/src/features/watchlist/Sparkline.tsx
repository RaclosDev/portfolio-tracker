import { pct, price } from '../../lib/format.ts';

const W = 84;
const H = 26;

/**
 * Tendencia de los últimos 3 meses en la fila. Color según si sube o baja en el periodo; la línea
 * discontinua es tu compra 1 si cae dentro del rango, para ver si el precio se acerca o se aleja.
 */
export function Sparkline({ closes, level }: { closes: number[] | undefined; level?: number | null }) {
  if (!closes) return <span className="muted small">…</span>;
  if (closes.length < 2) return <span className="muted small">–</span>;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const x = (i: number) => (i / (closes.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6);
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  const change = (last - first) / first;
  const d = closes.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join('');
  const showLevel = level != null && level >= min && level <= max;
  const label = `Últimos 3 meses: ${pct(change)} (de ${price(first)} a ${price(last)})`;
  return (
    <svg className={`spark spark--${change >= 0 ? 'up' : 'down'}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      {showLevel && <line className="spark__level" x1={0} x2={W} y1={y(level!)} y2={y(level!)} />}
      <path d={d} />
      <circle cx={x(closes.length - 1)} cy={y(last)} r={2.2} />
    </svg>
  );
}
