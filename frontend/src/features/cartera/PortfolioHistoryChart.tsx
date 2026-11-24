import { shiftDate, type PortfolioHistoryPoint } from '@/shared';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { DateField } from '../../components/DateField.tsx';
import { money } from '../../lib/format.ts';
import { signed } from './model.ts';

const H = 180;
const M = { left: 62, right: 12, top: 12, bottom: 26 };
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('es-ES');
const shortMoney = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const tickLabel = (v: number) => `${shortMoney.format(v)} €`;

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
  // La fecha fijada (campo «Consultar fecha» o clic en la gráfica) manda; pasar el ratón solo la previsualiza.
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const indexOf = (date: string | null) => (date == null ? -1 : points.findIndex((p) => p.date === date));
  const pinnedAt = indexOf(pinnedDate);
  const pinnedIndex = pinnedAt < 0 ? points.length - 1 : pinnedAt;
  const hoverAt = indexOf(hoverDate);
  const index = hoverAt < 0 ? pinnedIndex : hoverAt;
  const selected = points[index];
  // Las etiquetas del eje usan --fs-xs (0,857 rem): su ancho depende del tamaño de letra elegido en Ajustes.
  const labelPx = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.857;
  const geo = useMemo(() => {
    const values = points.flatMap((p) => compare ? [p.valueEur, p.constantFxEur] : [p[field]])
      .filter((n): n is number => n != null);
    const minValue = values.length ? Math.min(...values, ...(mode === 'result' ? [0] : [])) : 0;
    const maxValue = values.length ? Math.max(...values, ...(mode === 'result' ? [0] : [])) : 1;
    const pad = (maxValue - minValue || Math.abs(maxValue) * 0.1 || 1) * 0.12;
    const min = mode === 'result' ? minValue - pad : Math.max(0, minValue - pad);
    const max = maxValue + pad;
    const ticks = [0, 1, 2, 3].map((n) => min + (max - min) * n / 3);
    // Margen izquierdo: lo que ocupa la etiqueta más larga (≈0,56 em por carácter) más el hueco hasta la gráfica.
    const left = Math.max(M.left, Math.ceil(Math.max(...ticks.map((v) => tickLabel(v).length)) * labelPx * 0.56) + 14);
    const x = (i: number) => left + i / Math.max(1, points.length - 1) * (width - left - M.right);
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
    return { x, y, left, ticks, actual: path(field), fixed: path('constantFxEur'), hasValues: values.length > 0 };
  }, [points, compare, field, mode, width, labelPx]);

  if (!selected) return <p className="chart-empty muted">No hay fechas en este periodo.</p>;
  const first = points[0]!;
  const dateAt = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const x = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x;
    const next = Math.round((x - geo.left) / (width - geo.left - M.right) * (points.length - 1));
    return points[Math.max(0, Math.min(points.length - 1, next))]!.date;
  };
  const hover = (event: PointerEvent<SVGSVGElement>) => setHoverDate(dateAt(event));
  const pin = (event: PointerEvent<SVGSVGElement>) => {
    const date = dateAt(event);
    if (date) setPinnedDate(date);
    setHoverDate(null);
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
      aria-label={`${mode === 'result' ? 'Resultado económico' : 'Valor de cartera'} del ${dateLabel(first.date)} al ${dateLabel(points[points.length - 1]!.date)}${compare ? ', con y sin efecto divisa' : ''}. Consulta cada fecha en el campo inferior.`}
      onPointerMove={hover} onPointerDown={pin} onPointerLeave={() => setHoverDate(null)} onPointerCancel={() => setHoverDate(null)}>
      {geo.ticks.map((v) => <g key={v}>
        <line x1={geo.left} x2={width - M.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--border)" />
        <text x={geo.left - 10} y={geo.y(v) + 4} textAnchor="end">{tickLabel(v)}</text>
      </g>)}
      {mode === 'result' && <line x1={geo.left} x2={width - M.right} y1={geo.y(0)} y2={geo.y(0)} stroke="var(--text-2)" strokeDasharray="3 4" />}
      {[...new Set(width < 480 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1])].map((i) =>
        <text key={i} x={geo.x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{dateLabel(points[i]!.date)}</text>)}
      {compare && <path d={geo.fixed} className="portfolio-history__line portfolio-history__line--fixed" />}
      <path d={geo.actual} className="portfolio-history__line" />
      <line x1={geo.x(index)} x2={geo.x(index)} y1={M.top} y2={H - M.bottom} stroke="var(--text-2)" strokeDasharray="3 4" />
      {compare && selected.constantFxEur != null && <circle cx={geo.x(index)} cy={geo.y(selected.constantFxEur)} r={4} fill="var(--chart-3)" />}
      {selected[field] != null && <circle cx={geo.x(index)} cy={geo.y(selected[field])} r={4} fill="var(--accent)" />}
    </svg> : <p className="chart-empty muted">Faltan cotizaciones históricas para estas fechas. Revisa las cotizaciones de los valores o elige otro periodo.</p>}
    {compare && <div className="portfolio-history__legend" aria-label="Leyenda"><span>Con efecto divisa</span><span>Sin efecto divisa</span></div>}
    <div className="portfolio-history__cursor">
      <label>Consultar fecha <DateField min={first.date} max={points[points.length - 1]!.date} value={points[pinnedIndex]!.date}
        allowed={(d) => points.some((p) => p.date === d)} onChange={(d) => { setPinnedDate(d); setHoverDate(null); }} /></label>
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
