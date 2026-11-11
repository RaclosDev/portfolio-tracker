import type { PortfolioHistoryPoint } from '@watchlist/shared';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { money, pct } from '../../lib/format.ts';
import { signed } from './model.ts';

const H = 245;
const M = { left: 66, right: 16, top: 16, bottom: 30 };
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-ES');
const shortMoney = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

export function PortfolioHistoryChart({ points, compare }: { points: PortfolioHistoryPoint[]; compare: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(260, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedIndex = points.findIndex((p) => p.date === selectedDate);
  const index = selectedIndex < 0 ? points.length - 1 : selectedIndex;
  const selected = points[index];
  const geo = useMemo(() => {
    const values = points.flatMap((p) => compare ? [p.valueEur, p.constantFxEur] : [p.valueEur])
      .filter((n): n is number => n != null);
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 1;
    const pad = (maxValue - minValue || maxValue * 0.1 || 1) * 0.12;
    const min = Math.max(0, minValue - pad);
    const max = maxValue + pad;
    const x = (i: number) => M.left + i / Math.max(1, points.length - 1) * (width - M.left - M.right);
    const y = (v: number) => M.top + (max - v) / (max - min) * (H - M.top - M.bottom);
    const path = (field: 'valueEur' | 'constantFxEur') => {
      let connected = false;
      return points.map((p, i) => {
        if (p[field] == null) { connected = false; return ''; }
        const command = connected ? 'L' : 'M';
        connected = true;
        return `${command}${x(i).toFixed(2)},${y(p[field]).toFixed(2)}`;
      }).join(' ');
    };
    return { x, y, actual: path('valueEur'), fixed: path('constantFxEur'),
      ticks: [0, 1, 2, 3].map((n) => min + (max - min) * n / 3), hasValues: values.length > 0 };
  }, [points, compare, width]);

  if (!selected) return <p className="chart-empty muted">No hay fechas en este periodo.</p>;
  const first = points[0]!;
  const change = selected.valueEur != null && first.valueEur != null ? selected.valueEur - first.valueEur : null;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const x = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x;
    const next = Math.round((x - M.left) / (width - M.left - M.right) * (points.length - 1));
    setSelectedDate(points[Math.max(0, Math.min(points.length - 1, next))]!.date);
  };

  return <div className="portfolio-history" ref={container}>
    <div className="portfolio-history__readout">
      <div><span className="muted small">{compare ? 'Con efecto divisa' : 'Valor de cartera'}</span>
        <strong className="num">{money(selected.valueEur, 'EUR', 2)}</strong></div>
      {compare ? <>
        <div><span className="muted small">Sin efecto divisa</span><strong className="num">{money(selected.constantFxEur, 'EUR', 2)}</strong></div>
        <div><span className="muted small">Efecto divisa</span><strong className={`num delta ${signed(selected.fxEffectEur)}`}>{money(selected.fxEffectEur, 'EUR', 2)}</strong></div>
      </> : <div><span className="muted small">Cambio de valor desde el inicio</span>
        <strong className={`num delta ${signed(change)}`}>{money(change, 'EUR', 2)} <small>{pct(change != null && first.valueEur ? change / first.valueEur : null, 2)}</small></strong></div>}
    </div>
    {geo.hasValues ? <svg className="portfolio-history__svg" viewBox={`0 0 ${width} ${H}`} role="img"
      aria-label={`Valor de cartera del ${dateLabel(first.date)} al ${dateLabel(points[points.length - 1]!.date)}${compare ? ', con y sin efecto divisa' : ''}. Consulta cada fecha en el control inferior.`}
      onPointerMove={move} onPointerDown={move}>
      {geo.ticks.map((v) => <g key={v}>
        <line x1={M.left} x2={width - M.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--border)" />
        <text x={M.left - 10} y={geo.y(v) + 4} textAnchor="end">{shortMoney.format(v)} €</text>
      </g>)}
      {[...new Set(width < 480 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])].map((i) =>
        <text key={i} x={geo.x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{dateLabel(points[i]!.date)}</text>)}
      {compare && <path d={geo.fixed} className="portfolio-history__line portfolio-history__line--fixed" />}
      <path d={geo.actual} className="portfolio-history__line" />
      <line x1={geo.x(index)} x2={geo.x(index)} y1={M.top} y2={H - M.bottom} stroke="var(--text-2)" strokeDasharray="3 4" />
      {compare && selected.constantFxEur != null && <circle cx={geo.x(index)} cy={geo.y(selected.constantFxEur)} r={4} fill="var(--history-fixed)" />}
      {selected.valueEur != null && <circle cx={geo.x(index)} cy={geo.y(selected.valueEur)} r={4} fill="var(--accent)" />}
    </svg> : <p className="chart-empty muted">Faltan cotizaciones para valorar la cartera en estas fechas. Revisa los símbolos de Yahoo de los valores o elige otro periodo.</p>}
    {compare && <div className="portfolio-history__legend" aria-label="Leyenda"><span>Con efecto divisa</span><span>Sin efecto divisa</span></div>}
    <div className="portfolio-history__cursor">
      <label>Consultar fecha <input className="input" type="date" min={first.date} max={points[points.length - 1]!.date} value={selected.date}
        onChange={(e) => { if (points.some((p) => p.date === e.target.value)) setSelectedDate(e.target.value); }} /></label>
      <input type="range" min={0} max={points.length - 1} value={index} aria-label="Recorrer las fechas del gráfico"
        aria-valuetext={`${dateLabel(selected.date)}: ${money(selected.valueEur, 'EUR', 2)}`} onChange={(e) => setSelectedDate(points[Number(e.target.value)]!.date)} />
    </div>
    {selected.missing.length > 0 && <p className="small" role="status">Sin valoración completa el {dateLabel(selected.date)}: {selected.missing.join(', ')}.</p>}
  </div>;
}
