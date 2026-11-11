import { shiftDate, type PortfolioHistoryPoint } from '@watchlist/shared';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { money } from '../../lib/format.ts';
import { signed } from './model.ts';

const H = 180;
const M = { left: 62, right: 12, top: 12, bottom: 26 };
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-ES');
const shortMoney = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

export type HistoryMode = 'result' | 'value' | 'fx';

export function PortfolioHistoryChart({ points, mode }: { points: PortfolioHistoryPoint[]; mode: HistoryMode }) {
  const compare = mode === 'fx';
  const field = mode === 'result' ? 'resultEur' : 'valueEur';
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
    const values = points.flatMap((p) => compare ? [p.valueEur, p.constantFxEur] : [p[field]])
      .filter((n): n is number => n != null);
    const minValue = values.length ? Math.min(...values, ...(mode === 'result' ? [0] : [])) : 0;
    const maxValue = values.length ? Math.max(...values, ...(mode === 'result' ? [0] : [])) : 1;
    const pad = (maxValue - minValue || Math.abs(maxValue) * 0.1 || 1) * 0.12;
    const min = mode === 'result' ? minValue - pad : Math.max(0, minValue - pad);
    const max = maxValue + pad;
    const x = (i: number) => M.left + i / Math.max(1, points.length - 1) * (width - M.left - M.right);
    const y = (v: number) => M.top + (max - v) / (max - min) * (H - M.top - M.bottom);
    const path = (field: 'valueEur' | 'constantFxEur' | 'resultEur') => {
      let connected = false;
      return points.map((p, i) => {
        if (p[field] == null) { connected = false; return ''; }
        const command = connected ? 'L' : 'M';
        connected = true;
        return `${command}${x(i).toFixed(2)},${y(p[field]).toFixed(2)}`;
      }).join(' ');
    };
    return { x, y, actual: path(field), fixed: path('constantFxEur'),
      ticks: [0, 1, 2, 3].map((n) => min + (max - min) * n / 3), hasValues: values.length > 0 };
  }, [points, compare, field, mode, width]);

  if (!selected) return <p className="chart-empty muted">No hay fechas en este periodo.</p>;
  const first = points[0]!;
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const x = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x;
    const next = Math.round((x - M.left) / (width - M.left - M.right) * (points.length - 1));
    setSelectedDate(points[Math.max(0, Math.min(points.length - 1, next))]!.date);
  };

  return <div className="portfolio-history" ref={container}>
    <div className="portfolio-history__readout">
      <div><span className="muted small">{mode === 'result' ? 'Ganancia / pérdida del periodo' : compare ? 'Con efecto divisa' : 'Valor de las acciones'}</span>
        <strong className={`num${mode === 'result' ? ` delta ${signed(selected.resultEur)}` : ''}`}>{money(selected[field], 'EUR', 2)}</strong></div>
      {compare ? <>
        <div><span className="muted small">Sin efecto divisa</span><strong className="num">{money(selected.constantFxEur, 'EUR', 2)}</strong></div>
        <div><span className="muted small">Efecto divisa</span><strong className={`num delta ${signed(selected.fxEffectEur)}`}>{money(selected.fxEffectEur, 'EUR', 2)}</strong></div>
      </> : <div className="portfolio-history__asof"><span className="muted small">Hasta el {dateLabel(selected.date)}</span>
        <span className="small muted">{mode === 'result' ? 'Incluye ventas y cobros' : 'Sin efectivo'}</span></div>}
    </div>
    {geo.hasValues ? <svg className="portfolio-history__svg" viewBox={`0 0 ${width} ${H}`} role="img"
      aria-label={`${mode === 'result' ? 'Resultado económico' : 'Valor de cartera'} del ${dateLabel(first.date)} al ${dateLabel(points[points.length - 1]!.date)}${compare ? ', con y sin efecto divisa' : ''}. Consulta cada fecha en el control inferior.`}
      onPointerMove={move} onPointerDown={move}>
      {geo.ticks.map((v) => <g key={v}>
        <line x1={M.left} x2={width - M.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--border)" />
        <text x={M.left - 10} y={geo.y(v) + 4} textAnchor="end">{shortMoney.format(v)} €</text>
      </g>)}
      {mode === 'result' && <line x1={M.left} x2={width - M.right} y1={geo.y(0)} y2={geo.y(0)} stroke="var(--text-2)" strokeDasharray="3 4" />}
      {[...new Set(width < 480 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])].map((i) =>
        <text key={i} x={geo.x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{dateLabel(points[i]!.date)}</text>)}
      {compare && <path d={geo.fixed} className="portfolio-history__line portfolio-history__line--fixed" />}
      <path d={geo.actual} className="portfolio-history__line" />
      <line x1={geo.x(index)} x2={geo.x(index)} y1={M.top} y2={H - M.bottom} stroke="var(--text-2)" strokeDasharray="3 4" />
      {compare && selected.constantFxEur != null && <circle cx={geo.x(index)} cy={geo.y(selected.constantFxEur)} r={4} fill="var(--history-fixed)" />}
      {selected[field] != null && <circle cx={geo.x(index)} cy={geo.y(selected[field])} r={4} fill="var(--accent)" />}
    </svg> : <p className="chart-empty muted">Faltan cotizaciones para valorar la cartera en estas fechas. Revisa los símbolos de Yahoo de los valores o elige otro periodo.</p>}
    {compare && <div className="portfolio-history__legend" aria-label="Leyenda"><span>Con efecto divisa</span><span>Sin efecto divisa</span></div>}
    <div className="portfolio-history__cursor">
      <label>Consultar fecha <input className="input" type="date" min={first.date} max={points[points.length - 1]!.date} value={selected.date}
        onChange={(e) => { if (points.some((p) => p.date === e.target.value)) setSelectedDate(e.target.value); }} /></label>
      <input type="range" min={0} max={points.length - 1} value={index} aria-label="Recorrer las fechas del gráfico"
        aria-valuetext={`${dateLabel(selected.date)}: ${money(selected[field], 'EUR', 2)}`} onChange={(e) => setSelectedDate(points[Number(e.target.value)]!.date)} />
    </div>
    {mode === 'result' && <dl className="portfolio-history__bridge" aria-label="Desglose del resultado del periodo">
      <div><dt>Valor inicial <small>{dateLabel(shiftDate(first.date, -1))}</small></dt><dd>{money(selected.startingValueEur, 'EUR', 2)}</dd></div>
      <div><dt>Valor final <small>{dateLabel(selected.date)}</small></dt><dd>{money(selected.valueEur, 'EUR', 2)}</dd></div>
      <div><dt>Compras</dt><dd>{money(selected.purchasesEur, 'EUR', 2)}</dd></div>
      <div><dt>Importe de ventas</dt><dd>{money(selected.salesEur, 'EUR', 2)}</dd></div>
      <div><dt>Dividendos y otros cobros</dt><dd>{money(selected.incomeEur, 'EUR', 2)}</dd></div>
    </dl>}
    {selected.missing.length > 0 && <p className="small" role="status">Datos incompletos el {dateLabel(selected.date)}: {selected.missing.join(', ')}.</p>}
  </div>;
}
