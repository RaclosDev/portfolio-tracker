import { money, pct } from '../../lib/format.ts';

/** Porciones con color propio (--chart-1…9 en styles.css, por orden de peso). El resto se agrupa en «Otros». */
const MAX_SLICES = 9;
const sliceColor = (label: string, i: number) => (label === 'Otros' ? 'var(--chart-rest)' : `var(--chart-${i + 1})`);

export interface Slice {
  label: string;
  value: number;
}

/** Gráfico de anillo con leyenda: reparto del valor de la cartera (por valor, sector o bróker). */
export function Donut({ title, slices, showValues = false }: { title: string; slices: Slice[]; showValues?: boolean }) {
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
      {!showValues && <figcaption className="donut__title">{title}</figcaption>}
      {total <= 0 ? (
        <p className="muted small">No hay posiciones abiertas con valoración.</p>
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
                  stroke={sliceColor(s.label, i)}
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
                <i style={{ background: sliceColor(s.label, i) }} aria-hidden />
                <span className="donut__label" title={s.label}>{s.label}</span>
                <span className="num muted">{pct(s.value / total, 0).replace('+', '')}{showValues && <small>{money(s.value, 'EUR', 2)}</small>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}
