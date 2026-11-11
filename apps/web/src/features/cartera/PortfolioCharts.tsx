import { localToday } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { Donut, type Slice } from './Donut.tsx';
import { HISTORY_PERIODS, periodStart, type HistoryPeriod } from './historyRange.ts';
import type { CarteraModel } from './model.ts';
import { PortfolioHistoryChart, type HistoryMode } from './PortfolioHistoryChart.tsx';

const VIEWS = [
  { label: 'Resultado', title: 'Resultado del periodo' },
  { label: 'Valor', title: 'Capital en acciones' },
  { label: 'Divisas', title: 'Valor y efecto divisa' },
  { label: 'Valores', title: 'Por valor' },
  { label: 'Sectores', title: 'Por sector' },
  { label: 'Brókeres', title: 'Por bróker' },
];

interface HistorySelection {
  period: HistoryPeriod | 'custom';
  custom: { from: string; to: string };
}

function History({ first, mode, selection, onSelection }: {
  first: string; mode: HistoryMode; selection: HistorySelection; onSelection: (selection: HistorySelection) => void;
}) {
  const today = localToday();
  const { period, custom } = selection;
  const { from, to } = period === 'custom' ? custom : { from: periodStart(period, today, first), to: today };
  const valid = !!from && !!to && from >= first && to <= today && from <= to;
  const history = useQuery({ queryKey: ['portfolio', 'history', from, to], queryFn: () => api.portfolioHistory(from, to),
    enabled: valid, staleTime: 5 * 60_000, retry: 1 });
  const setDate = (field: 'from' | 'to', value: string) => {
    onSelection({ custom: { from, to, [field]: value }, period: 'custom' });
  };
  return <>
    <div className="portfolio-periods" role="group" aria-label="Periodo del histórico">
      {HISTORY_PERIODS.map((p) => <button type="button" key={p.id} title={p.title} aria-label={p.title} aria-pressed={period === p.id} onClick={() => onSelection({ ...selection, period: p.id })}>{p.label}</button>)}
    </div>
    <div className="portfolio-dates">
      <label>Desde <input type="date" className="input" value={from} min={first} max={to || today} onChange={(e) => setDate('from', e.target.value)} /></label>
      <label>Hasta <input type="date" className="input" value={to} min={from || first} max={today} onChange={(e) => setDate('to', e.target.value)} /></label>
    </div>
    {!valid ? <p role="alert" className="error-box">Elige un periodo entre tu primera operación y hoy, con la fecha inicial anterior o igual a la final.</p>
      : history.isPending ? <p className="chart-empty muted" role="status">Cargando precios y cambios históricos…</p>
      : history.isError ? <div className="error-box" role="alert">No se pudo cargar el histórico. <button className="btn" onClick={() => void history.refetch()}>Reintentar</button></div>
      : <>
        {history.data.available && <p className="small" role="status">
          Histórico parcial: {history.data.available.included} de {history.data.available.included + history.data.available.excluded.length} valores.
          {' '}Sin histórico disponible de {history.data.available.excluded.map(i => i.name).join(', ')}.
          {' '}El gráfico y su resultado excluyen esos valores y todas sus compras, ventas y cobros.
        </p>}
        <PortfolioHistoryChart key={`${from}:${to}`} points={history.data.available?.points ?? history.data.points} mode={mode} />
        {history.data.stale && <p className="small muted">No se han podido actualizar todos los históricos. Se muestran los datos disponibles en caché. <button className="link-btn" onClick={() => void history.refetch()}>Reintentar</button></p>}
        {!history.data.available && history.data.missing.length > 0 && <p className="small muted">Hay huecos por falta de datos de {history.data.missing.join(', ')}. No se suman valores parciales.</p>}
      </>}
    <p className="portfolio-chart-note">{mode === 'result'
      ? 'Resultado = valor final − valor inicial − compras + ventas + cobros. Base: cierre anterior al periodo. Cobros después de comisiones y retención en origen, antes del IRPF español.'
      : mode === 'fx'
        ? 'Comparación de las acciones que tienes en cada fecha, manteniendo el cambio del inicio. El efecto divisa mostrado no incluye ventas ni cobros ya realizados.'
        : 'Valor de las acciones en cada fecha, sin saldo en efectivo. Una venta reduce este valor; el beneficio se conserva en Resultado.'}</p>
  </>;
}

export function PortfolioCharts({ model, byBroker }: { model: CarteraModel; byBroker: Slice[] }) {
  const [view, setView] = useState(0);
  const first = model.view.operations.reduce((d, o) => o.date < d ? o.date : d, localToday());
  const [selection, setSelection] = useState<HistorySelection>(() => ({
    period: '1y', custom: { from: periodStart('1y', localToday(), first), to: localToday() },
  }));
  const slices = view === 3 ? model.valuation.open.map((r) => ({ label: r.name, value: r.valueEur ?? 0 }))
    : view === 4 ? model.valuation.bySector.map((s) => ({ label: s.sector, value: s.valueEur })) : byBroker;
  return <section className="portfolio-charts" aria-label="Gráficos de la cartera">
    <div className="portfolio-charts__heading">
      <h3 id="portfolio-chart-title">{VIEWS[view]!.title}</h3>
      <div className="portfolio-charts__arrows">
        <span className="small muted" aria-live="polite">{view + 1} / {VIEWS.length}</span>
        <button type="button" className="btn" aria-label="Gráfica anterior" onClick={() => setView((view + VIEWS.length - 1) % VIEWS.length)}>←</button>
        <button type="button" className="btn" aria-label="Gráfica siguiente" onClick={() => setView((view + 1) % VIEWS.length)}>→</button>
      </div>
    </div>
    <div className="portfolio-chart-tabs" role="group" aria-label="Elegir gráfica">
      {VIEWS.map(({ label, title }, i) => <button type="button" key={label} title={title} aria-pressed={view === i} onClick={() => setView(i)}>{label}</button>)}
    </div>
    <div role="region" aria-labelledby="portfolio-chart-title">
      {view < 3 ? <History first={first} mode={view === 0 ? 'result' : view === 1 ? 'value' : 'fx'} selection={selection} onSelection={setSelection} /> : <>
        <p className="small muted">Distribución del valor actual de la cartera.</p>
        <Donut title={VIEWS[view]!.title} slices={slices} showValues />
        {model.valuation.summary.missing.length > 0 && <p className="small muted">Reparto parcial: faltan precios de {model.valuation.summary.missing.join(', ')}.</p>}
      </>}
    </div>
  </section>;
}
