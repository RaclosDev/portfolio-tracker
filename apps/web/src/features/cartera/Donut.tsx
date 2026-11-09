import { money, pct } from '../../lib/format.ts';

/** Colores de las porciones (los primeros, los de más peso). El resto se agrupa en «Otros». */
const COLORS = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#059669', '#dc2626', '#0891b2', '#65a30d', '#9333ea'];
const MAX_SLICES = 9;

export interface Slice {
  label: string;
  value: number;
}

/** Gráfico de anillo con leyenda: reparto del valor de la cartera (por valor, sector o bróker). */
export function Donut({ title, slices }: { title: string; slices: Slice[] }) {
  const sorted = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES).reduce((s, x) => s + x.value, 0);
  if (rest > 0) shown.push({ label: 'Otros', value: rest });
  const total = shown.reduce((s, x) => s + x.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <figure className="donut">
      <figcaption className="donut__title">{title}</figcaption>
      {total <= 0 ? (
        <p className="muted small">Sin datos.</p>
      ) : (
        <div className="donut__body">
          <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label={title}>
            <circle cx={70} cy={70} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={20} />
            {shown.map((s, i) => {
              const len = (s.value / total) * C;
              const el = (
                <circle
                  key={s.label}
                  cx={70}
                  cy={70}
                  r={R}
                  fill="none"
                  stroke={s.label === 'Otros' ? 'var(--text-2)' : COLORS[i % COLORS.length]}
                  strokeWidth={20}
                  strokeDasharray={`${Math.max(0, len - 1)} ${C}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                >
                  <title>{`${s.label}: ${money(s.value, 'EUR', 2)} (${pct(s.value / total).replace('+', '')})`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
          </svg>
          <ul className="donut__legend">
            {shown.map((s, i) => (
              <li key={s.label}>
                <i style={{ background: s.label === 'Otros' ? 'var(--text-2)' : COLORS[i % COLORS.length] }} aria-hidden />
                <span className="donut__label">{s.label}</span>
                <span className="num muted">{pct(s.value / total, 0).replace('+', '')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}
