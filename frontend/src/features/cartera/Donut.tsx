import { money, pct } from '../../lib/format.ts';

/** Porciones con color propio (--chart-1…9 en styles.css, por orden de peso). El resto se agrupa en «Otros». */
const MAX_SLICES = 9;
const sliceColor = (label: string, i: number) => (label === 'Otros' ? 'var(--chart-rest)' : `var(--chart-${i + 1})`);

export interface Slice {
  label: string;
  value: number;
}

/** Anillo con el total en el centro y leyenda en columnas (nombre, importe y peso): reparto de la cartera. */
export function Donut({ title, slices }: { title: string; slices: Slice[] }) {
  const sorted = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES).reduce((s, x) => s + x.value, 0);
  if (rest > 0) shown.push({ label: 'Otros', value: rest });
  const total = shown.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="muted small">No hay posiciones abiertas con valoración.</p>;
  const R = 60;
  const C = 2 * Math.PI * R;
  // Los pesos pequeños llevan un decimal para que no salgan varios «1 %» iguales.
  const share = (v: number) => pct(v / total, v / total < 0.1 ? 1 : 0).replace('+', '');
  let offset = 0;
  return (
    <figure className="donut">
      <div className="donut__ring">
        <svg viewBox="0 0 160 160" role="img" aria-label={title}>
          <circle cx={80} cy={80} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={18} />
          {shown.map((s, i) => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx={80}
                cy={80}
                r={R}
                fill="none"
                stroke={sliceColor(s.label, i)}
                strokeWidth={18}
                strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
                data-tip={`${s.label}: ${money(s.value, 'EUR', 2)} (${share(s.value)})`}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut__center" aria-hidden>
          <span className="num">{money(total, 'EUR', 0)}</span>
          <small>{sorted.length} {sorted.length === 1 ? 'parte' : 'partes'}</small>
        </div>
      </div>
      <table className="donut__legend">
        <caption className="sr-only">{title}</caption>
        <tbody>
          {shown.map((s, i) => (
            <tr key={s.label}>
              <th scope="row">
                <span className="donut__name">
                  <i style={{ background: sliceColor(s.label, i) }} aria-hidden />
                  <span className="donut__label" title={s.label}>
                    {s.label === 'Otros' ? `Otros ${sorted.length - MAX_SLICES}` : s.label}
                  </span>
                </span>
              </th>
              <td className="num">{money(s.value, 'EUR', 0)}</td>
              <td className="num donut__pct">{share(s.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
