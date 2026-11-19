import type { Candle, ChartDrawing, ChartDrawingType, ChartPoint, WatchlistRow } from '@watchlist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { api } from '../../api/client.ts';
import {
  aggregate,
  DEFAULT_DRAWING_COLOR,
  distToSegment,
  dragHandle,
  DRAWING_COLORS,
  ema,
  fromLogical,
  insidePolygon,
  moveDrawing,
  newDrawingId,
  periodBase,
  periodReturn,
  PERIODS,
  round7,
  sma,
  snapPrice,
  isIntraday,
  mergeLive,
  toLogical,
  TOOL_CLICKS,
  type PeriodId,
  type Step,
  type Tool,
} from './chartDrawing.ts';
import { ChartIcon, type IconName } from './chartIcons.tsx';
import { DEFAULT_TEXT, DrawingsPrimitive } from './DrawingsPrimitive.ts';

type ChartType = 'candles' | 'area' | 'line';
type ScaleMode = 'normal' | 'log' | 'percent';
interface Indicator {
  id: string;
  kind: 'sma' | 'ema';
  period: number;
  color: string;
  hidden?: boolean;
}
type DrawTool = Exclude<Tool, 'cursor'>;

const NO_DRAWINGS: ChartDrawing[] = [];
const NO_CANDLES: Candle[] = [];
const HIT_PX = 6;
const HANDLE_PX = 8;
const RIGHT_OFFSET = 8;

const STEPS: [Step, string, string][] = [
  ['1m', '1m', '1 minuto'], ['5m', '5m', '5 minutos'], ['15m', '15m', '15 minutos'], ['30m', '30m', '30 minutos'],
  ['1h', '1h', '1 hora'], ['4h', '4h', '4 horas'], ['D', 'D', 'Diario'], ['W', 'S', 'Semanal'], ['M', 'M', 'Mensual'],
];
const STEP_LABEL: Record<Step, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', D: '1D', W: '1S', M: '1M' };
/**
 * Tiempo de una vela para Lightweight Charts: la fecha de sesión tal cual o, en intradía, segundos desplazados
 * a la hora local (la librería pinta las marcas de tiempo en UTC).
 */
function chartTime(t: string): Time {
  if (t.length === 10) return t as Time;
  const ms = Date.parse(t);
  return (ms / 1000 - new Date(ms).getTimezoneOffset() * 60) as UTCTimestamp;
}
/** Fecha corta de una vela, con la hora si es intradía. */
const fmtBarDate = (t: string) =>
  t.length > 10
    ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : new Date(`${t}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const CHART_TYPES: [ChartType, string][] = [['candles', 'Velas'], ['area', 'Área'], ['line', 'Línea']];
const SCALES: [ScaleMode, string, string][] = [
  ['normal', 'Lineal', 'Escala lineal'],
  ['log', 'Log', 'Escala logarítmica'],
  ['percent', '%', 'Escala en porcentaje'],
];
const TOOL_INFO: Record<DrawTool, [label: string, shortcut?: string]> = {
  trend: ['Línea de tendencia', 'Alt+T'],
  ray: ['Rayo'],
  extended: ['Línea extendida'],
  hline: ['Línea horizontal', 'Alt+H'],
  hray: ['Rayo horizontal', 'Alt+J'],
  vline: ['Línea vertical', 'Alt+V'],
  channel: ['Canal paralelo'],
  fib: ['Retroceso de Fibonacci', 'Alt+F'],
  rect: ['Rectángulo', 'Alt+Shift+R'],
  arrow: ['Flecha'],
  text: ['Texto'],
  long: ['Posición larga'],
  short: ['Posición corta'],
  measure: ['Medir'],
};
const GROUPS: { id: string; label: string; tools: DrawTool[] }[] = [
  { id: 'lines', label: 'Líneas', tools: ['trend', 'ray', 'extended', 'hline', 'hray', 'vline', 'channel'] },
  { id: 'fib', label: 'Fibonacci', tools: ['fib'] },
  { id: 'shapes', label: 'Formas', tools: ['rect', 'arrow'] },
  { id: 'text', label: 'Texto', tools: ['text'] },
  { id: 'forecast', label: 'Previsión', tools: ['long', 'short'] },
  { id: 'measure', label: 'Medir', tools: ['measure'] },
];
const SHORTCUTS: Record<string, DrawTool> = { KeyT: 'trend', KeyH: 'hline', KeyJ: 'hray', KeyV: 'vline', KeyF: 'fib' };
const IND_COLORS = ['#f6a609', '#2962ff', '#e040fb', '#00bcd4', '#43a047'];
const DEFAULT_INDICATORS: Indicator[] = [{ id: 'sma-20', kind: 'sma', period: 20, color: IND_COLORS[0]! }];
const STYLES: [NonNullable<ChartDrawing['style']>, string][] = [['solid', 'Continua'], ['dashed', 'Discontinua'], ['dotted', 'Punteada']];

const isIndicators = (v: unknown) =>
  Array.isArray(v) &&
  v.every((i) => i && typeof i === 'object' && (i.kind === 'sma' || i.kind === 'ema') && Number.isInteger(i.period) && i.period >= 1 && i.period <= 500 && typeof i.color === 'string' && typeof i.id === 'string');

/** Estado guardado en el navegador (el formato antiguo del periodo era texto sin JSON). */
function usePersisted<T>(key: string, fallback: T, valid: (v: unknown) => boolean) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    let v: unknown = raw;
    try { v = JSON.parse(raw); } catch { /* texto suelto */ }
    return valid(v) ? (v as T) : fallback;
  });
  const set = (v: T) => {
    setValue(v);
    localStorage.setItem(key, JSON.stringify(v));
  };
  return [value, set] as const;
}

/** Color CSS (variables, color-mix…) resuelto a rgb, que es lo que entiende el gráfico. */
function resolveColor(css: string): string {
  const probe = document.createElement('span');
  probe.style.color = css;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return computed;
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function themeColors() {
  return {
    text: resolveColor('var(--text-2)'),
    grid: resolveColor('var(--border)'),
    up: resolveColor('var(--up)'),
    down: resolveColor('var(--down)'),
    accent: resolveColor('var(--accent)'),
  };
}
type Colors = ReturnType<typeof themeColors>;
const withAlpha = (rgb: string, a: number) => rgb.replace(/^rgb\((.*)\)$/, `rgba($1, ${a})`);

function mainSeriesOptions(kind: ChartType, c: Colors) {
  if (kind === 'line') return { color: c.accent };
  if (kind === 'area') return { lineColor: c.accent, topColor: withAlpha(c.accent, 0.28), bottomColor: withAlpha(c.accent, 0) };
  return { upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down };
}

const precisionFor = (price: number) => (price < 1 ? 4 : price < 10 ? 3 : 2);
const fmtPct = (r: number) => `${r >= 0 ? '+' : ''}${(r * 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

interface Props {
  row: WatchlistRow;
  /** Símbolo de TradingView, si lo tiene: para el enlace de abrirlo allí. */
  tvSymbol: string | null;
}

/**
 * Gráfico de velas (Lightweight Charts, de TradingView) con las herramientas de Financial Hub: intervalos
 * diario, semanal y mensual, velas, área o línea, medias móviles, escala lineal, logarítmica o en porcentaje,
 * periodos con su rentabilidad y dibujos guardados en la cuenta (líneas, canales, Fibonacci, formas, texto y
 * posiciones), que se seleccionan, se arrastran y se editan. Las compras de la lista y la orden salen como
 * líneas discontinuas.
 */
export function CandleChart({ row, tvSymbol }: Props) {
  const { item, metrics } = row;
  const symbol = item.symbol;
  const qc = useQueryClient();
  const candlesQ = useQuery({
    queryKey: ['candles', symbol],
    queryFn: () => api.candles(symbol),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const drawingsQ = useQuery({ queryKey: ['drawings', symbol], queryFn: () => api.drawings(symbol), staleTime: Infinity });
  const save = useMutation({
    mutationFn: (next: ChartDrawing[]) => api.saveDrawings(symbol, next),
    onMutate: (next) => qc.setQueryData(['drawings', symbol], next),
    onError: () => qc.invalidateQueries({ queryKey: ['drawings', symbol] }),
  });
  const drawings = drawingsQ.data ?? NO_DRAWINGS;
  const candles = candlesQ.data?.candles ?? NO_CANDLES;
  const flat = candles.length > 0 && candles.every((c) => c.o === c.c && c.h === c.c && c.l === c.c);

  const [step, setStep] = usePersisted<Step>('watchlist.velas.intervalo', 'D', (v) => STEPS.some(([s]) => s === v));
  // Los fondos solo tienen valor liquidativo diario: sin intradía.
  const intraday = isIntraday(step) && !flat;
  const intradayQ = useQuery({
    queryKey: ['candles', symbol, step],
    queryFn: () => api.candles(symbol, step as Exclude<Step, 'D' | 'W' | 'M'>),
    enabled: intraday,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // Precio casi en directo solo del gráfico abierto (se pausa con la pestaña en segundo plano).
  const liveQ = useQuery({
    queryKey: ['live', symbol],
    queryFn: () => api.live(symbol),
    enabled: candles.length > 0 && !flat,
    refetchInterval: 2_000,
    staleTime: 1_000,
    retry: false,
  });
  const liveQuote = liveQ.data;
  useEffect(() => {
    if (!liveQuote?.price) return;
    const { price, priceTime } = liveQuote;
    type Data = { candles: Candle[]; stale: boolean };
    const put = (key: unknown[], s: 'D' | Exclude<Step, 'D' | 'W' | 'M'>) =>
      qc.setQueryData<Data>(key, (d) => {
        if (!d) return d;
        const next = mergeLive(d.candles, price, priceTime, s);
        return next === d.candles ? d : { ...d, candles: next };
      });
    put(['candles', symbol], 'D');
    if (intraday) put(['candles', symbol, step], step as Exclude<Step, 'D' | 'W' | 'M'>);
  }, [liveQuote, qc, symbol, intraday, step]);
  const [chartType, setChartType] = usePersisted<ChartType>('watchlist.velas.tipo', 'candles', (v) => CHART_TYPES.some(([t]) => t === v));
  const [scale, setScale] = usePersisted<ScaleMode>('watchlist.velas.escala', 'normal', (v) => SCALES.some(([s]) => s === v));
  const [period, setPeriod] = usePersisted<PeriodId>('watchlist.velas.periodo', '1y', (v) => PERIODS.some(([p]) => p === v));
  const [indicators, setIndicators] = usePersisted<Indicator[]>('watchlist.velas.indicadores', DEFAULT_INDICATORS, isIndicators);
  const [magnet, setMagnet] = usePersisted<boolean>('watchlist.velas.iman', false, (v) => typeof v === 'boolean');
  const [stay, setStay] = useState(false);
  const [lockAll, setLockAll] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [tool, setTool] = useState<Tool>('cursor');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<ChartPoint[]>([]);
  const [groupTool, setGroupTool] = useState<Record<string, DrawTool>>({});
  const [flyout, setFlyout] = useState<{ group: string; top: number } | null>(null);
  const [indOpen, setIndOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const kind: ChartType = flat && chartType === 'candles' ? 'line' : chartType;
  const intradayBars = intradayQ.data?.candles ?? NO_CANDLES;
  /** Intervalo de lo que se pinta (un fondo en intradía se ve en diario). */
  const shown: Step = intraday || !isIntraday(step) ? step : 'D';
  const bars = useMemo(() => (intraday ? intradayBars : aggregate(candles, shown)), [candles, intradayBars, intraday, shown]);
  const precision = precisionFor(candles.at(-1)?.c ?? 1);
  const indData = useMemo(() => {
    const closes = bars.map((b) => b.c);
    return indicators.map((ind) => ({ ind, values: (ind.kind === 'sma' ? sma : ema)(closes, ind.period) }));
  }, [bars, indicators]);
  const returns = useMemo(() => new Map(PERIODS.map(([id]) => [id, periodReturn(candles, id)])), [candles]);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const primRef = useRef(new DrawingsPrimitive());
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const indSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const datesRef = useRef<string[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const fittedRef = useRef(false);
  const stepRef = useRef(step);
  const savedRangeRef = useRef<LogicalRange | null>(null);
  const legendRef = useRef<((i: number | null) => void) | null>(null);
  const undoRef = useRef<ChartDrawing[][]>([]);
  const redoRef = useRef<ChartDrawing[][]>([]);

  /** Guarda los dibujos y apunta el estado anterior para deshacer. */
  const commit = (next: ChartDrawing[]) => {
    undoRef.current = [...undoRef.current.slice(-99), drawings];
    redoRef.current = [];
    save.mutate(next);
    rerender();
  };
  const undo = () => {
    const prev = undoRef.current.at(-1);
    if (!prev) return;
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, drawings];
    save.mutate(prev);
    setSelected(null);
    rerender();
  };
  const redo = () => {
    const next = redoRef.current.at(-1);
    if (!next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, drawings];
    save.mutate(next);
    setSelected(null);
    rerender();
  };

  const create = (type: ChartDrawingType, pts: ChartPoint[]) => {
    let points = pts;
    if (type === 'long' || type === 'short') {
      // Objetivo a un 5 % y stop a un 2,5 % de la entrada; se ajustan arrastrando sus puntos.
      const e = pts[0]!;
      const s = type === 'long' ? 1 : -1;
      const ahead = shown === 'W' ? 8 : shown === 'M' ? 4 : 20;
      const end = fromLogical(datesRef.current, toLogical(datesRef.current, e.t, shown) + ahead, shown);
      points = [e, { t: end, p: round7(e.p * (1 + 0.05 * s)) }, { t: e.t, p: round7(e.p * (1 - 0.025 * s)) }];
    }
    const d: ChartDrawing = { id: newDrawingId(), type, points, ...(type === 'text' ? { text: DEFAULT_TEXT } : {}) };
    commit([...drawings, d]);
    setPending([]);
    if (!stay || type === 'text') {
      setTool('cursor');
      setSelected(d.id);
    }
  };

  // Lo último de cada estado para los manejadores del gráfico, que se suscriben una sola vez.
  const live = useRef({ tool, pending, drawings, selected, magnet, lockAll, hidden, step: shown });
  live.current = { tool, pending, drawings, selected, magnet, lockAll, hidden, step: shown };
  const act = useRef({ commit, create });
  act.current = { commit, create };

  const hasData = candles.length > 0;
  // Gráfico y serie: se crean de nuevo si cambia el tipo (velas, área o línea), conservando el encuadre.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !hasData) return;
    const colors = themeColors();
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: colors.text, fontFamily: 'inherit' },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, rightOffset: RIGHT_OFFSET },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'es-ES' },
    });
    const series: ISeriesApi<SeriesType> = kind === 'line'
      ? chart.addSeries(LineSeries, { ...mainSeriesOptions(kind, colors), lineWidth: 2 })
      : kind === 'area'
        ? chart.addSeries(AreaSeries, { ...mainSeriesOptions(kind, colors), lineWidth: 2 })
        : chart.addSeries(CandlestickSeries, mainSeriesOptions(kind, colors));
    const prim = primRef.current;
    prim.colors = { text: colors.text, up: colors.up, down: colors.down };
    series.attachPrimitive(prim);
    chartRef.current = chart;
    seriesRef.current = series;
    fittedRef.current = false;

    // Tema claro/oscuro: se repintan los colores al cambiarlo.
    const retheme = () => {
      const c = themeColors();
      chart.applyOptions({
        layout: { textColor: c.text },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.grid },
        timeScale: { borderColor: c.grid },
      });
      series.applyOptions(mainSeriesOptions(kind, c));
      prim.colors = { text: c.text, up: c.up, down: c.down };
      prim.update();
    };
    const observer = new MutationObserver(retheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', retheme);

    /** Punto del gráfico (fecha y precio) en unas coordenadas del panel; con el imán, pegado a la vela. */
    const pointAt = (x: number, y: number, snap: boolean, logical?: number | null): ChartPoint | null => {
      const l = logical ?? chart.timeScale().coordinateToLogical(x);
      const p = series.coordinateToPrice(y);
      if (l == null || p == null) return null;
      const bar = snap && live.current.magnet ? barsRef.current[Math.round(l)] : undefined;
      return { t: fromLogical(datesRef.current, l, live.current.step), p: round7(bar ? snapPrice(bar, p) : p) };
    };
    /** Dibujo bajo el puntero: primero las asas del seleccionado y luego los dibujos, del de encima al de abajo. */
    const hitTest = (x: number, y: number): { id: string; handle: number | null } | null => {
      const L = live.current;
      if (L.hidden) return null;
      const all = prim.drawings;
      const sel = all.find((d) => d.id === L.selected);
      if (sel && sel.type !== 'text') {
        const i = prim.geo(sel).handles.findIndex((h) => !!h && Math.hypot(h[0] - x, h[1] - y) <= HANDLE_PX);
        if (i >= 0) return { id: sel.id, handle: i };
      }
      for (let k = all.length - 1; k >= 0; k--) {
        const d = all[k]!;
        const g = prim.geo(d);
        const near = HIT_PX + (d.width ?? 2) / 2;
        if (g.lines.some((s) => distToSegment(x, y, ...s) <= near) || g.areas.some((a) => insidePolygon(x, y, a))) {
          return { id: d.id, handle: null };
        }
      }
      return null;
    };
    const local = (e: PointerEvent): [number, number] => {
      const rect = box.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };
    // Fuera del panel de precios (en los ejes) no se dibuja ni se selecciona.
    const inPane = (x: number, y: number) =>
      x >= 0 && y >= 0 && x <= chart.timeScale().width() && y <= box.clientHeight - chart.timeScale().height();

    const onClick = (x: number, y: number) => {
      const L = live.current;
      if (L.tool === 'cursor') {
        setSelected(hitTest(x, y)?.id ?? null);
        return;
      }
      const point = pointAt(x, y, true);
      if (!point) return;
      if (L.tool === 'measure') {
        const m = prim.measure;
        prim.measure = m && !m.done ? { ...m, b: point, done: true } : { a: point, b: point, done: false };
        prim.update();
        return;
      }
      const pts = [...L.pending, point];
      if (pts.length < TOOL_CLICKS[L.tool]) setPending(pts);
      else act.current.create(L.tool, pts);
    };
    const onCrosshair = (param: MouseEventParams<Time>) => {
      const i = param.logical == null ? null : Math.round(param.logical);
      legendRef.current?.(i != null && i >= 0 && i < barsRef.current.length ? i : null);
      const L = live.current;
      if (!param.point) return;
      if (L.tool === 'measure' && prim.measure && !prim.measure.done) {
        const b = pointAt(param.point.x, param.point.y, true, param.logical);
        if (b) prim.measure = { ...prim.measure, b };
        prim.update();
      } else if (L.tool !== 'cursor' && L.tool !== 'measure' && L.pending.length) {
        const cursor = pointAt(param.point.x, param.point.y, true, param.logical);
        prim.preview = cursor ? { type: L.tool, points: [...L.pending, cursor] } : null;
        prim.update();
      }
    };

    // Los clics se leen del puntero y no de subscribeClick: el gráfico se traga el segundo clic si llega
    // rápido (lo toma por un doble clic fallido), y al dibujar se hacen clics seguidos en sitios distintos.
    // Un arrastre no cuenta como clic: mueve el gráfico o, si empieza en un dibujo, el dibujo. Para eso se
    // apaga el desplazamiento del gráfico antes de que lo vea (escucha el ratón, que llega después del puntero).
    let down: { x: number; y: number } | null = null;
    let drag: { d: ChartDrawing; handle: number | null; l0: number; p0: number; next: ChartDrawing | null } | null = null;
    const onDown = (e: PointerEvent) => {
      rootRef.current?.focus({ preventScroll: true });
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      const L = live.current;
      if (!down || L.tool !== 'cursor') return;
      const [x, y] = local(e);
      if (!inPane(x, y)) return;
      const hit = hitTest(x, y);
      if (!hit) return;
      setSelected(hit.id);
      const d = L.drawings.find((dd) => dd.id === hit.id);
      const l0 = chart.timeScale().coordinateToLogical(x);
      const p0 = series.coordinateToPrice(y);
      if (!d || d.locked || L.lockAll || l0 == null || p0 == null) return;
      drag = { d, handle: hit.handle, l0, p0, next: null };
      chart.applyOptions({ handleScroll: false, handleScale: false });
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = local(e);
      const L = live.current;
      if (drag) {
        const l = chart.timeScale().coordinateToLogical(x);
        const p = series.coordinateToPrice(y);
        if (l == null || p == null) return;
        let next: ChartDrawing;
        if (drag.handle == null) next = moveDrawing(drag.d, Math.round(l - drag.l0), p - drag.p0, datesRef.current, L.step);
        else {
          const pt = pointAt(x, y, true);
          if (!pt) return;
          next = dragHandle(drag.d, drag.handle, pt);
        }
        drag.next = next;
        prim.drawings = L.drawings.map((d) => (d.id === next.id ? next : d));
        prim.update();
        return;
      }
      if (e.target instanceof Node && box.contains(e.target)) {
        const hit = L.tool === 'cursor' && inPane(x, y) ? hitTest(x, y) : null;
        box.dataset.hover = hit ? (hit.handle != null ? 'handle' : 'drawing') : '';
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        const { next } = drag;
        drag = null;
        down = null;
        chart.applyOptions({ handleScroll: true, handleScale: true });
        if (next) act.current.commit(live.current.drawings.map((d) => (d.id === next.id ? next : d)));
        return;
      }
      if (!down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) {
        down = null;
        return;
      }
      down = null;
      const [x, y] = local(e);
      if (inPane(x, y)) onClick(x, y);
    };
    box.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', retheme);
      box.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      chart.unsubscribeCrosshairMove(onCrosshair);
      savedRangeRef.current = chart.timeScale().getVisibleLogicalRange();
      levelLinesRef.current = [];
      indSeriesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [hasData, kind, symbol]);

  const showPeriod = (id: PeriodId) => {
    const chart = chartRef.current;
    const n = datesRef.current.length;
    if (!chart || !n) return;
    const base = periodBase(candles, id);
    // En intradía el periodo empieza en la primera vela de la sesión siguiente a la de referencia.
    const start = base == null ? undefined : intraday ? candles[base + 1]?.t : candles[base]!.t;
    const from = start == null ? 0 : Math.max(0, toLogical(datesRef.current, start, shown));
    // Siempre se ven unas cuantas barras, aunque el periodo sea de uno o cinco días.
    chart.timeScale().setVisibleLogicalRange({ from: Math.min(from, n - 15), to: n - 1 + RIGHT_OFFSET });
  };

  // Datos: se actualizan sin perder el zoom; la primera vez (o al cambiar de intervalo) se encuadra el periodo.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    chart.applyOptions({ timeScale: { timeVisible: isIntraday(shown), secondsVisible: false } });
    if (!bars.length) {
      series.setData([]);
      datesRef.current = [];
      barsRef.current = [];
      return;
    }
    datesRef.current = bars.map((b) => b.t);
    barsRef.current = bars;
    const prim = primRef.current;
    prim.dates = datesRef.current;
    prim.step = shown;
    prim.precision = precision;
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    if (kind === 'candles') (series as ISeriesApi<'Candlestick'>).setData(bars.map((c) => ({ time: chartTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
    else (series as ISeriesApi<'Line'>).setData(bars.map((c) => ({ time: chartTime(c.t), value: c.c })));
    if (!fittedRef.current || stepRef.current !== shown) {
      const saved = savedRangeRef.current;
      if (!fittedRef.current && saved && stepRef.current === shown) chart.timeScale().setVisibleLogicalRange(saved);
      else showPeriod(period);
      fittedRef.current = true;
      stepRef.current = shown;
      savedRangeRef.current = null;
    }
    prim.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, kind]);

  // Medias móviles: una línea por indicador visible.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of indSeriesRef.current) chart.removeSeries(s);
    indSeriesRef.current = indData
      .filter(({ ind }) => !ind.hidden)
      .map(({ ind, values }) => {
        const s = chart.addSeries(LineSeries, {
          color: ind.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
        });
        s.setData(values.flatMap((v, i) => (v == null ? [] : [{ time: chartTime(bars[i]!.t), value: v }])));
        return s;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indData, hasData, kind]);

  useEffect(() => {
    chartRef.current?.priceScale('right').applyOptions({
      mode: scale === 'log' ? PriceScaleMode.Logarithmic : scale === 'percent' ? PriceScaleMode.Percentage : PriceScaleMode.Normal,
    });
  }, [scale, hasData, kind]);

  // Compras de la lista y orden: líneas discontinuas fijas.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of levelLinesRef.current) series.removePriceLine(l);
    const colors = themeColors();
    levelLinesRef.current = [
      ...metrics.levels.map((l, i) => series.createPriceLine({
        price: l.price, color: colors.accent, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Compra ${i + 1}`,
      })),
      ...(item.orderActive && item.orderPrice ? [series.createPriceLine({
        price: item.orderPrice, color: colors.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Orden',
      })] : []),
    ];
  }, [metrics.levels, item.orderActive, item.orderPrice, hasData, kind]);

  useEffect(() => {
    const prim = primRef.current;
    prim.drawings = drawings;
    prim.selected = selected;
    prim.hidden = hidden;
    if (tool === 'cursor' || !pending.length) prim.preview = null;
    if (tool !== 'measure') prim.measure = null;
    prim.update();
  }, [drawings, selected, tool, pending, hidden, hasData, kind]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Los menús desplegables se cierran al pulsar fuera.
  useEffect(() => {
    if (!flyout && !indOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.xp-candles__flyout, .xp-candles__panel, [data-popover]')) {
        setFlyout(null);
        setIndOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [flyout, indOpen]);

  const chooseTool = (t: Tool) => {
    const next = t !== 'cursor' && t === tool ? 'cursor' : t;
    setTool(next);
    setPending([]);
    setFlyout(null);
    if (next !== 'cursor') {
      setSelected(null);
      const group = GROUPS.find((g) => g.tools.includes(next));
      if (group) setGroupTool((m) => ({ ...m, [group.id]: next }));
    }
  };
  const selectedDrawing = hidden ? undefined : drawings.find((d) => d.id === selected);
  const patchSelected = (patch: Partial<ChartDrawing>) => {
    if (selectedDrawing) commit(drawings.map((d) => (d.id === selectedDrawing.id ? { ...d, ...patch } : d)));
  };
  const removeSelected = () => {
    if (!selectedDrawing) return;
    commit(drawings.filter((d) => d.id !== selectedDrawing.id));
    setSelected(null);
  };
  const removeAll = () => {
    if (drawings.length && confirm(`¿Borrar los ${drawings.length} dibujos de este valor?`)) {
      commit([]);
      setSelected(null);
    }
  };
  const zoom = (factor: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    ts.setVisibleLogicalRange({ from: r.to - (r.to - r.from) * factor, to: r.to });
  };
  const screenshot = () => {
    const canvas = chartRef.current?.takeScreenshot(true);
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${symbol}-${candles.at(-1)?.t ?? 'grafico'}.png`;
    a.click();
  };
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  };
  const openFlyout = (group: string, el: HTMLElement) => {
    if (flyout?.group === group) return setFlyout(null);
    const top = el.getBoundingClientRect().top - (stageRef.current?.getBoundingClientRect().top ?? 0);
    setFlyout({ group, top });
  };
  const updateIndicator = (id: string, patch: Partial<Indicator>) =>
    setIndicators(indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const addIndicator = (k: Indicator['kind']) =>
    setIndicators([...indicators, { id: newDrawingId(), kind: k, period: k === 'sma' ? 50 : 20, color: IND_COLORS[indicators.length % IND_COLORS.length]! }]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      chooseTool('cursor');
      setSelected(null);
      setIndOpen(false);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawing && !selectedDrawing.locked && !lockAll) {
      e.preventDefault();
      removeSelected();
    } else if (mod && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) redo();
      else undo();
    } else if (e.altKey && !mod) {
      const t = e.shiftKey ? (e.code === 'KeyR' ? 'rect' : undefined) : SHORTCUTS[e.code];
      if (t) {
        e.preventDefault();
        chooseTool(t);
      }
    }
  };

  const toolTitle = (t: DrawTool) => (TOOL_INFO[t][1] ? `${TOOL_INFO[t][0]} (${TOOL_INFO[t][1]})` : TOOL_INFO[t][0]);
  const hint = tool === 'cursor'
    ? selectedDrawing
      ? selectedDrawing.locked || lockAll ? 'Dibujo bloqueado.' : 'Arrastra el dibujo o sus puntos para moverlo. Supr para borrarlo.'
      : 'Pulsa un dibujo para seleccionarlo.'
    : tool === 'measure'
      ? 'Medir: haz clic en el inicio y en el final. Esc para salir.'
      : TOOL_CLICKS[tool] === 1
        ? `${TOOL_INFO[tool][0]}: haz clic en el gráfico. Esc para cancelar.`
        : `${TOOL_INFO[tool][0]}: punto ${pending.length + 1} de ${TOOL_CLICKS[tool]}. Esc para cancelar.`;
  const last = bars.at(-1);
  const toggle = (icon: IconName, label: string, on: boolean, onClick: () => void) => (
    <button type="button" className={on ? 'on' : ''} aria-pressed={on} title={label} aria-label={label} onClick={onClick}>
      <ChartIcon name={icon} />
    </button>
  );
  const flyoutGroup = flyout && GROUPS.find((g) => g.id === flyout.group);

  return (
    <div className={`xp-candles${full ? ' is-full' : ''}`} ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="xp-candles__top" role="toolbar" aria-label="Opciones del gráfico">
        <div className="segmented segmented--small" role="group" aria-label="Intervalo">
          {STEPS.map(([s, label, title]) => (
            <button
              key={s}
              type="button"
              className={step === s ? 'on' : ''}
              aria-pressed={step === s}
              title={flat && isIntraday(s) ? `${title}: los fondos solo tienen un valor al día` : title}
              disabled={flat && isIntraday(s)}
              onClick={() => setStep(s)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="segmented segmented--small" role="group" aria-label="Tipo de gráfico">
          {CHART_TYPES.map(([t, label]) => (
            <button
              key={t}
              type="button"
              className={kind === t ? 'on' : ''}
              aria-pressed={kind === t}
              disabled={flat && t === 'candles'}
              title={flat && t === 'candles' ? 'Este valor solo tiene un precio al día' : undefined}
              onClick={() => setChartType(t)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--small" data-popover aria-expanded={indOpen} onClick={() => setIndOpen(!indOpen)}>
          <ChartIcon name="indicators" /> Indicadores
        </button>
        <div className="xp-candles__icons">
          <button type="button" title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled={!undoRef.current.length} onClick={undo}><ChartIcon name="undo" /></button>
          <button type="button" title="Rehacer (Ctrl+Y)" aria-label="Rehacer" disabled={!redoRef.current.length} onClick={redo}><ChartIcon name="redo" /></button>
        </div>
        <div className="xp-candles__icons xp-candles__push">
          <button type="button" title="Descargar imagen" aria-label="Descargar imagen" disabled={!hasData} onClick={screenshot}><ChartIcon name="camera" /></button>
          <button type="button" title={full ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-label="Pantalla completa" aria-pressed={full} onClick={toggleFull}>
            <ChartIcon name="fullscreen" />
          </button>
        </div>
      </div>

      <div className="xp-candles__stage" ref={stageRef}>
        <div className="xp-candles__tools" role="toolbar" aria-orientation="vertical" aria-label="Herramientas de dibujo">
          {toggle('cursor', 'Cursor', tool === 'cursor', () => chooseTool('cursor'))}
          {GROUPS.map((g) => {
            const cur = groupTool[g.id] ?? g.tools[0]!;
            return (
              <div className="xp-candles__group" key={g.id}>
                {toggle(cur, toolTitle(cur), tool === cur, () => chooseTool(cur))}
                {g.tools.length > 1 && (
                  <button
                    type="button"
                    className="xp-candles__more"
                    data-popover
                    aria-label={`Más herramientas: ${g.label}`}
                    aria-expanded={flyout?.group === g.id}
                    onClick={(e) => openFlyout(g.id, e.currentTarget.parentElement!)}
                  >
                    <ChartIcon name="caret" />
                  </button>
                )}
              </div>
            );
          })}
          <hr />
          {toggle('zoomIn', 'Acercar', false, () => zoom(0.7))}
          {toggle('zoomOut', 'Alejar', false, () => zoom(1 / 0.7))}
          <hr />
          {toggle('magnet', 'Imán: pega los puntos a la apertura, máximo, mínimo o cierre', magnet, () => setMagnet(!magnet))}
          {toggle('stay', 'Seguir dibujando', stay, () => setStay(!stay))}
          {toggle('lock', 'Bloquear dibujos', lockAll, () => setLockAll(!lockAll))}
          {toggle('eye', 'Ocultar dibujos', hidden, () => { setHidden(!hidden); setSelected(null); })}
          <button type="button" title="Eliminar dibujos" aria-label="Eliminar dibujos" disabled={!drawings.length} onClick={removeAll}>
            <ChartIcon name="trash" />
          </button>
        </div>

        <div className="xp-candles__pane">
          <div
            className={`xp-candles__chart${tool !== 'cursor' ? ' is-drawing' : ''}`}
            ref={boxRef}
            aria-label={`Gráfico de velas de ${item.name ?? symbol}`}
            role="img"
          >
            {candlesQ.isLoading && <p className="muted small xp-candles__msg">Cargando velas…</p>}
            {!candlesQ.isLoading && !hasData && <p className="muted small xp-candles__msg">No hay velas de este valor en las fuentes de datos.</p>}
            {hasData && intraday && intradayQ.isLoading && <p className="muted small xp-candles__msg">Cargando velas de {STEP_LABEL[step]}…</p>}
            {hasData && intraday && !intradayQ.isLoading && !intradayBars.length && (
              <p className="muted small xp-candles__msg">No hay velas de {STEP_LABEL[step]} de este valor en las fuentes de datos.</p>
            )}
          </div>
          {hasData && (
            <Legend name={item.name ?? symbol} step={shown} bars={bars} flat={flat} indData={indData} precision={precision} setter={legendRef} />
          )}
          {selectedDrawing && (
            <EditBar
              key={selectedDrawing.id}
              drawing={selectedDrawing}
              locked={lockAll}
              onPatch={patchSelected}
              onRemove={removeSelected}
            />
          )}
        </div>

        {flyoutGroup && (
          <div className="xp-candles__flyout" role="menu" aria-label={flyoutGroup.label} style={{ top: flyout.top }}>
            {flyoutGroup.tools.map((t) => (
              <button key={t} type="button" role="menuitemradio" aria-checked={tool === t} className={tool === t ? 'on' : ''} onClick={() => chooseTool(t)}>
                <ChartIcon name={t} />
                <span>{TOOL_INFO[t][0]}</span>
                {TOOL_INFO[t][1] && <kbd>{TOOL_INFO[t][1]}</kbd>}
              </button>
            ))}
          </div>
        )}

        {indOpen && (
          <div className="xp-candles__panel" role="dialog" aria-label="Indicadores">
            <strong className="small">Medias móviles</strong>
            {indicators.length === 0 && <p className="muted small">Sin indicadores.</p>}
            {indicators.map((ind) => (
              <div className="xp-candles__ind" key={ind.id}>
                <span className="xp-candles__dot" style={{ background: ind.color }} />
                <select aria-label="Tipo de media" value={ind.kind} onChange={(e) => updateIndicator(ind.id, { kind: e.target.value as Indicator['kind'] })}>
                  <option value="sma">SMA</option>
                  <option value="ema">EMA</option>
                </select>
                <input
                  type="number"
                  aria-label="Periodo"
                  min={1}
                  max={500}
                  value={ind.period}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (n >= 1 && n <= 500) updateIndicator(ind.id, { period: n });
                  }}
                />
                <button type="button" className="icon-btn" aria-pressed={!ind.hidden} title={ind.hidden ? 'Mostrar' : 'Ocultar'} onClick={() => updateIndicator(ind.id, { hidden: !ind.hidden })}>
                  <ChartIcon name="eye" />
                </button>
                <button type="button" className="icon-btn" title="Quitar" aria-label="Quitar" onClick={() => setIndicators(indicators.filter((i) => i.id !== ind.id))}>
                  <ChartIcon name="trash" />
                </button>
              </div>
            ))}
            <div className="xp-candles__ind-add">
              <button type="button" className="btn btn--small" onClick={() => addIndicator('sma')}>+ SMA</button>
              <button type="button" className="btn btn--small" onClick={() => addIndicator('ema')}>+ EMA</button>
            </div>
          </div>
        )}
      </div>

      <div className="xp-candles__bottom">
        <div className="segmented segmented--small xp-candles__periods" role="group" aria-label="Periodo">
          {PERIODS.map(([id, label]) => {
            const r = returns.get(id) ?? null;
            return (
              <button
                key={id}
                type="button"
                className={period === id ? 'on' : ''}
                aria-pressed={period === id}
                disabled={r == null && id !== 'max'}
                title={r == null ? 'Sin datos de tan atrás' : `${label}: ${fmtPct(r)}`}
                onClick={() => { setPeriod(id); showPeriod(id); }}
              >
                <span>{label}</span>
                {r != null && <small className={r >= 0 ? 'up' : 'down'}>{fmtPct(r)}</small>}
              </button>
            );
          })}
        </div>
        <div className="segmented segmented--small" role="group" aria-label="Escala">
          {SCALES.map(([s, label, title]) => (
            <button key={s} type="button" className={scale === s ? 'on' : ''} aria-pressed={scale === s} title={title} onClick={() => setScale(s)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="muted small xp-candles__note">
        {hint}
        {last && <> · Última vela {fmtBarDate(last.t)}</>}
        {(intraday ? intradayQ.data?.stale : candlesQ.data?.stale) && <> · Datos guardados: la fuente no responde</>}
        {save.isError && <> · No se pudo guardar el dibujo</>}
        {tvSymbol && (
          <>
            {' · '}
            <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`} target="_blank" rel="noreferrer">
              Abrir en TradingView
            </a>
          </>
        )}
      </p>
    </div>
  );
}

interface LegendProps {
  name: string;
  step: Step;
  bars: Candle[];
  flat: boolean;
  indData: { ind: Indicator; values: (number | null)[] }[];
  precision: number;
  setter: MutableRefObject<((i: number | null) => void) | null>;
}

/** Leyenda de arriba a la izquierda: la vela bajo el cursor (o la última) y el valor de las medias. */
function Legend({ name, step, bars, flat, indData, precision, setter }: LegendProps) {
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    setter.current = setHover;
    return () => { setter.current = null; };
  }, [setter]);
  const i = hover != null && hover < bars.length ? hover : bars.length - 1;
  const bar = bars[i];
  if (!bar) return null;
  const prev = bars[i - 1];
  const change = prev ? bar.c - prev.c : null;
  const f = (v: number) => v.toLocaleString('es-ES', { minimumFractionDigits: precision, maximumFractionDigits: precision });
  const tone = change == null ? '' : change >= 0 ? 'up' : 'down';
  return (
    <div className="xp-candles__legend" aria-hidden="true">
      <div>
        <strong>{name}</strong> · {STEP_LABEL[step]}
        {!flat && <> · A <b className={tone}>{f(bar.o)}</b> M <b className={tone}>{f(bar.h)}</b> m <b className={tone}>{f(bar.l)}</b></>}
        {' '}C <b className={tone}>{f(bar.c)}</b>
        {change != null && prev && <b className={tone}> {change >= 0 ? '+' : ''}{f(change)} ({fmtPct(change / prev.c)})</b>}
      </div>
      {indData.filter(({ ind }) => !ind.hidden).map(({ ind, values }) => (
        <div key={ind.id} style={{ color: ind.color }}>
          {ind.kind.toUpperCase()} {ind.period} <b>{values[i] != null ? f(values[i]!) : '—'}</b>
        </div>
      ))}
    </div>
  );
}

interface EditBarProps {
  drawing: ChartDrawing;
  /** Todos los dibujos bloqueados. */
  locked: boolean;
  onPatch: (patch: Partial<ChartDrawing>) => void;
  onRemove: () => void;
}

/** Barra flotante del dibujo seleccionado: color, grosor, estilo, texto, bloqueo y borrar. */
function EditBar({ drawing: d, locked, onPatch, onRemove }: EditBarProps) {
  const [text, setText] = useState(d.text ?? '');
  const color = d.color ?? DEFAULT_DRAWING_COLOR;
  const lineLike = d.type !== 'text' && d.type !== 'long' && d.type !== 'short';
  const off = locked || !!d.locked;
  return (
    <div className="xp-candles__edit" role="toolbar" aria-label="Dibujo seleccionado">
      {d.type !== 'long' && d.type !== 'short' && DRAWING_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`xp-candles__swatch${color === c ? ' on' : ''}`}
          style={{ background: c }}
          aria-label={`Color ${c}`}
          aria-pressed={color === c}
          disabled={off}
          onClick={() => onPatch({ color: c })}
        />
      ))}
      {lineLike && (
        <>
          <select aria-label="Grosor" value={d.width ?? 2} disabled={off} onChange={(e) => onPatch({ width: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w} px</option>)}
          </select>
          <select aria-label="Estilo de línea" value={d.style ?? 'solid'} disabled={off} onChange={(e) => onPatch({ style: e.target.value as ChartDrawing['style'] })}>
            {STYLES.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
          </select>
        </>
      )}
      {d.type === 'text' && (
        <input
          aria-label="Texto"
          value={text}
          maxLength={200}
          disabled={off}
          autoFocus={!off}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text !== (d.text ?? '')) onPatch({ text }); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
        />
      )}
      <button
        type="button"
        className={`icon-btn${d.locked ? ' on' : ''}`}
        aria-pressed={!!d.locked}
        title={d.locked ? 'Desbloquear' : 'Bloquear'}
        aria-label={d.locked ? 'Desbloquear' : 'Bloquear'}
        disabled={locked}
        onClick={() => onPatch({ locked: !d.locked })}
      >
        <ChartIcon name="lock" />
      </button>
      <button type="button" className="icon-btn" title="Eliminar" aria-label="Eliminar" disabled={off} onClick={onRemove}>
        <ChartIcon name="trash" />
      </button>
    </div>
  );
}
