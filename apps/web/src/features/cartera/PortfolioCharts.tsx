import { localToday, type PortfolioHistoryPoint } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { Donut, type Slice } from './Donut.tsx';
import { Icon } from '../../components/Icon.tsx';
import { HISTORY_PERIODS, periodStart, type HistoryPeriod } from './historyRange.ts';
import type { CarteraModel } from './model.ts';
import { ChartSkeleton } from '../../components/Skeleton.tsx';
import { PortfolioHistoryChart, type HistoryMode } from './PortfolioHistoryChart.tsx';

const VIEWS: { label: string; title: string; mode: HistoryMode }[] = [
  { label: 'Resultado', title: 'Resultado del periodo', mode: 'result' },
  { label: 'Valor', title: 'Capital en acciones', mode: 'value' },
  { label: 'Divisas', title: 'Valor y efecto divisa', mode: 'fx' },
];
const MIXES = [
  { id: 'valor', title: 'Por valor' },
  { id: 'sector', title: 'Por sector' },
  { id: 'broker', title: 'Por bróker' },
] as const;
const MIX_KEY = 'watchlist.cartera.reparto';

interface HistorySelection {
  period: HistoryPeriod | 'custom';
  custom: { from: string; to: string };
}

/**
 * El histórico valora con cierres; el resumen, con el precio en directo. Si el periodo acaba hoy, el último punto
 * toma el valor del resumen para que las dos cifras cuadren (el efecto divisa no cambia).
 */
function withLiveToday(points: PortfolioHistoryPoint[], today: string, live: number | null): PortfolioHistoryPoint[] {
  const last = points.at(-1);
  if (live == null || !last || last.date !== today || last.valueEur == null || last.missing.length) return points;
  const delta = live - last.valueEur;
  const add = (v: number | null) => (v == null ? v : v + delta);
  return [...points.slice(0, -1), { ...last, valueEur: live, constantFxEur: add(last.constantFxEur), resultEur: add(last.resultEur) }];
}

function History({ first, mode, selection, onSelection, liveValue }: {
  first: string; mode: HistoryMode; selection: HistorySelection; onSelection: (selection: HistorySelection) => void; liveValue: number | null;
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
      : history.isPending ? <ChartSkeleton height={280} label="Cargando precios y cambios históricos…" />
      : history.isError ? <div className="error-box" role="alert">No se pudo cargar el histórico. <button className="btn" onClick={() => void history.refetch()}>Reintentar</button></div>
      : <>
        {history.data.available && <p className="small" role="status">
          Histórico parcial: {history.data.available.included} de {history.data.available.included + history.data.available.excluded.length} valores.
          {' '}Sin histórico disponible de {history.data.available.excluded.map(i => i.name).join(', ')}.
          {' '}El gráfico y su resultado excluyen esos valores y todas sus compras, ventas y cobros.
        </p>}
        <PortfolioHistoryChart key={`${from}:${to}`} points={history.data.available ? history.data.available.points : withLiveToday(history.data.points, today, liveValue)} mode={mode} />
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

/** Evolución de la cartera en el tiempo: resultado, valor y efecto divisa del periodo elegido. */
export function PortfolioCharts({ model }: { model: CarteraModel }) {
  const [view, setView] = useState(0);
  const first = model.view.operations.reduce((d, o) => o.date < d ? o.date : d, localToday());
  const [selection, setSelection] = useState<HistorySelection>(() => ({
    period: '1y', custom: { from: periodStart('1y', localToday(), first), to: localToday() },
  }));
  return <section className="pcard portfolio-charts" aria-labelledby="portfolio-chart-title">
    <div className="pcard__head">
      <h2 id="portfolio-chart-title">Evolución <span className="pcard__sub">· {VIEWS[view]!.title.toLowerCase()}</span></h2>
    </div>
    <div className="portfolio-chart-tabs" role="group" aria-label="Elegir gráfica">
      {VIEWS.map(({ label, title }, i) => <button type="button" key={label} title={title} aria-pressed={view === i} onClick={() => setView(i)}>{label}</button>)}
    </div>
    <History first={first} mode={VIEWS[view]!.mode} selection={selection} onSelection={setSelection}
      liveValue={model.valuation.summary.missing.length ? null : model.valuation.summary.valueEur} />
  </section>;
}

/** Reparto del valor actual: un solo gráfico que cambia entre valor, sector y bróker con las flechas. */
export function PortfolioMix({ model, byBroker }: { model: CarteraModel; byBroker: Slice[] }) {
  const [i, setI] = useState(() => Math.max(0, MIXES.findIndex((m) => m.id === localStorage.getItem(MIX_KEY))));
  const go = (step: number) => {
    const next = (i + step + MIXES.length) % MIXES.length;
    setI(next);
    localStorage.setItem(MIX_KEY, MIXES[next]!.id);
  };
  const mix = MIXES[i]!;
  const prev = MIXES[(i + MIXES.length - 1) % MIXES.length]!;
  const next = MIXES[(i + 1) % MIXES.length]!;
  const slices = mix.id === 'valor' ? model.valuation.open.map((r) => ({ label: r.name, value: r.valueEur ?? 0 }))
    : mix.id === 'sector' ? model.valuation.bySector.map((s) => ({ label: s.sector, value: s.valueEur })) : byBroker;
  return <section className="pcard portfolio-mix" aria-labelledby="portfolio-mix-title">
    <div className="pcard__head">
      <h2 id="portfolio-mix-title">Reparto <span className="pcard__sub">· {mix.title.toLowerCase()}</span></h2>
      <div className="mix-nav" role="group" aria-label="Cambiar reparto">
        <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label={`Ver reparto ${prev.title.toLowerCase()}`} title={prev.title}>
          <Icon name="chevron" />
        </button>
        <span className="mix-nav__dots" aria-hidden>
          {MIXES.map((m, k) => <i key={m.id} className={k === i ? 'on' : undefined} />)}
        </span>
        <button type="button" className="icon-btn" onClick={() => go(1)} aria-label={`Ver reparto ${next.title.toLowerCase()}`} title={next.title}>
          <Icon name="chevron" />
        </button>
      </div>
    </div>
    <Donut title={`Reparto ${mix.title.toLowerCase()}`} slices={slices} />
    {model.valuation.summary.missing.length > 0 && <p className="pcard__note">Reparto parcial: faltan precios de {model.valuation.summary.missing.join(', ')}.</p>}
  </section>;
}
