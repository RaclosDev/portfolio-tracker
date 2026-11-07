import type { HistoryRange, LevelStatus, PricePoint } from '@watchlist/shared';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { pct, price } from '../../lib/format.ts';

export interface RefLine {
  label: string;
  value: number;
  /** Determina el color: estado del nivel de compra, orden u objetivo. */
  kind: LevelStatus | 'order' | 'broker' | 'consensus';
}

const W = 640;
const H = 300;
const M = { top: 14, right: 118, bottom: 28, left: 52 };

/** Valores "redondos" para las marcas del eje vertical. */
function niceTicks(min: number, max: number, count = 5) {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmtDate = (iso: string, range: HistoryRange) =>
  new Date(iso).toLocaleDateString('es-ES', range === '1y' || range === '5y' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });

/**
 * Gráfico de precios con tus referencias encima. Las etiquetas de las líneas van a la derecha,
 * fuera del área de datos, para no tapar la curva. Al pasar el ratón se lee fecha y precio.
 */
export function HistoryChart({ points, refs, range }: { points: PricePoint[]; refs: RefLine[]; range: HistoryRange }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const closes = points.map((p) => p.c);
    const values = [...closes, ...refs.map((r) => r.value)];
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min || max * 0.1 || 1) * 0.06;
    min -= pad;
    max += pad;
    const x = (i: number) => M.left + (i / Math.max(points.length - 1, 1)) * (W - M.left - M.right);
    const y = (v: number) => M.top + (1 - (v - min) / (max - min)) * (H - M.top - M.bottom);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.c).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)} ${H - M.bottom}L${x(0).toFixed(1)} ${H - M.bottom}Z`;
    const xTicks = points.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (points.length - 1))) : [];
    // Etiquetas de referencia sin solaparse: se separan al menos 13 px en vertical.
    const labels = refs
      .map((r) => ({ ...r, y: y(r.value) }))
      .sort((a, b) => a.y - b.y)
      .reduce<(RefLine & { y: number; ly: number })[]>((acc, r) => {
        const prev = acc[acc.length - 1];
        acc.push({ ...r, ly: prev ? Math.max(r.y, prev.ly + 13) : r.y });
        return acc;
      }, []);
    return { x, y, line, area, yTicks: niceTicks(min, max), xTicks, labels, min, max };
  }, [points, refs]);

  if (points.length < 2) return <p className="muted chart-empty">No hay datos de cotización para este periodo.</p>;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const lowest = points.reduce((a, b) => (b.c < a.c ? b : a));
  const highest = points.reduce((a, b) => (b.c > a.c ? b : a));
  const summary = `De ${price(first.c)} a ${price(last.c)} (${pct((last.c - first.c) / first.c)}). Mínimo ${price(lowest.c)} el ${new Date(lowest.t).toLocaleDateString('es-ES')}, máximo ${price(highest.c)} el ${new Date(highest.t).toLocaleDateString('es-ES')}.`;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const f = (px - M.left) / (W - M.left - M.right);
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(f * (points.length - 1)))));
  };
  const h = hover != null ? points[hover]! : null;

  return (
    <figure className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label={summary}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {geo.yTicks.map((v) => (
          <g key={v} className="chart__grid">
            <line x1={M.left} x2={W - M.right} y1={geo.y(v)} y2={geo.y(v)} />
            <text x={M.left - 6} y={geo.y(v) + 3.5} textAnchor="end">
              {price(v)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((i, k) => (
          <text key={k} className="chart__xlabel" x={geo.x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === geo.xTicks.length - 1 ? 'end' : 'middle'}>
            {fmtDate(points[i]!.t, range)}
          </text>
        ))}

        <path className="chart__area" d={geo.area} />
        <path className="chart__line" d={geo.line} />

        {geo.labels.map((r) => (
          <g key={`${r.label}-${r.value}`} className={`chart__ref chart__ref--${r.kind}`}>
            <line x1={M.left} x2={W - M.right} y1={r.y} y2={r.y} />
            <text x={W - M.right + 6} y={r.ly + 3.5}>
              {r.label} {price(r.value)}
            </text>
          </g>
        ))}

        <circle className="chart__last" cx={geo.x(points.length - 1)} cy={geo.y(last.c)} r={3.5} />

        {h && (
          <g className="chart__hover">
            <line x1={geo.x(hover!)} x2={geo.x(hover!)} y1={M.top} y2={H - M.bottom} />
            <circle cx={geo.x(hover!)} cy={geo.y(h.c)} r={4} />
          </g>
        )}
      </svg>
      <figcaption className="chart__caption" aria-live="polite">
        {h ? (
          <>
            <strong>{new Date(h.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>: {price(h.c)}
          </>
        ) : (
          summary
        )}
      </figcaption>
    </figure>
  );
}
