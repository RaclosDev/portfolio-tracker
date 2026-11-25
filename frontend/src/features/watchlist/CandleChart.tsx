import type { Candle, ChartDrawing, ChartDrawingType, ChartPoint } from '@/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { api } from '../../api/client.ts';
import type { ChartLine, ChartMark } from './chartLines.ts';
import { decimals } from '../../lib/format.ts';
import {
  aggregate,
  DEFAULT_DRAWING_COLOR,
  distToSegment,
  dragHandle,
  DRAWING_COLORS,
  fromLogical,
  insidePolygon,
  moveDrawing,
  newDrawingId,
  periodBase,
  periodReturn,
  PERIODS,
  round7,
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
import { BandFillPrimitive } from './BandFillPrimitive.ts';
import {
  defaultParams,
  IND_COLORS,
  IND_GROUPS,
  INDICATOR_DEFS,
  indicatorLabel,
  normalizeIndicator,
  TEMPLATES,
  fmtVolume,
  hasVolume,
  type Indicator,
  type IndicatorDef,
  type IndKind,
  type Series,
} from './indicators.ts';

type ChartType = 'candles' | 'line';
type ScaleMode = 'normal' | 'log' | 'percent';
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
const CHART_TYPES: [ChartType, string][] = [['candles', 'Velas'], ['line', 'Línea']];
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
const VOLUME_INDICATOR: Indicator = { id: 'volume-20', kind: 'volume', params: { n: 20 }, color: IND_COLORS[1]! };
const DEFAULT_INDICATORS: Indicator[] = [{ id: 'sma-20', kind: 'sma', params: { n: 20 }, color: IND_COLORS[0]! }, VOLUME_INDICATOR];
/** Marca de que el volumen ya se añadió una vez a los indicadores guardados: si luego se quita, no vuelve. */
const VOLUME_ADDED_KEY = 'watchlist.velas.volumenAnadido';
const IND_LIST = Object.values(INDICATOR_DEFS);
const LEVEL_COLOR = 'rgba(140, 143, 154, 0.85)';
const HIST_UP = 'rgba(38, 166, 154, 0.6)';
const HIST_DOWN = 'rgba(239, 83, 80, 0.6)';
/** Alto de cada panel de osciladores frente al del precio. */
const SUB_STRETCH = 0.32;
const fold = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return Number.isNaN(n) ? hex : `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const STYLES: [NonNullable<ChartDrawing['style']>, string][] = [['solid', 'Continua'], ['dashed', 'Discontinua'], ['dotted', 'Punteada']];

const isIndicators = (v: unknown) => Array.isArray(v) && v.every((i) => normalizeIndicator(i) != null);

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

function mainSeriesOptions(kind: ChartType, c: Colors) {
  if (kind === 'line') return { color: c.accent };
  return { upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down };
}

const sameBar = (a: Candle, b: Candle) => a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c;
const precisionFor = (price: number) => (price < 1 ? 4 : price < 10 ? 3 : 2);
/** Decimales del eje y la leyenda: todos los que traiga el precio (hasta 6), nunca menos que los de su magnitud. */
function pricePrecision(bars: Candle[], ...prices: (number | null | undefined)[]) {
  let d = precisionFor(bars.at(-1)?.c ?? prices.find((p) => p != null) ?? 1);
  for (const b of bars.slice(-50)) d = Math.max(d, decimals(b.o), decimals(b.h), decimals(b.l), decimals(b.c));
  for (const p of prices) if (p != null) d = Math.max(d, decimals(p));
  return Math.min(6, d);
}
const fmtPct = (r: number) => `${r >= 0 ? '+' : ''}${(r * 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

/** Color de una línea fija, ya resuelto para el gráfico. */
function lineColor(l: ChartLine, c: Colors) {
  if (l.status === 'broker' || l.status === 'consensus') return resolveColor(`var(--pm-${l.status})`);
  if (l.status && l.status !== 'unknown') return resolveColor(`var(--${l.status}-fg)`);
  return l.style === 'dotted' ? c.text : c.accent;
}

interface Props {
  symbol: string;
  name: string;
  /** Último precio conocido, para afinar los decimales. */
  price?: number | null;
  lines: ChartLine[];
  /** Símbolo de TradingView, si lo tiene: para el enlace de abrirlo allí. */
  tvSymbol: string | null;
  /** Operaciones propias (compras y ventas) marcadas sobre la vela de su fecha. */
  marks?: ChartMark[];
}

/**
 * Gráfico de velas (Lightweight Charts, de TradingView) con las herramientas de Financial Hub: intervalos
 * diario, semanal y mensual, velas o línea, medias móviles, escala lineal, logarítmica o en porcentaje,
 * periodos con su rentabilidad y dibujos guardados en la cuenta (líneas, canales, Fibonacci, formas, texto y
 * posiciones), que se seleccionan, se arrastran y se editan. Las compras de la lista y la orden salen como
 * líneas discontinuas.
 */
export function CandleChart({ symbol, name, price: quoted, lines, tvSymbol, marks }: Props) {
  const linesKey = JSON.stringify(lines);
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
  const recent = candlesQ.data?.candles ?? NO_CANDLES;
  /** Toda la historia del valor: se pide solo al alejar el gráfico hasta el principio de los cinco años. */
  const [wantAllOf, setWantAllOf] = useState<string | null>(null);
  const wantAll = wantAllOf === symbol;
  const allQ = useQuery({
    queryKey: ['candles', symbol, 'max'],
    queryFn: () => api.allCandles(symbol),
    enabled: wantAll,
    staleTime: 6 * 3_600_000,
    retry: false,
  });
  const older = allQ.data?.candles;
  // Lo antiguo se antepone a las velas recientes, que son las que se actualizan en directo.
  const candles = useMemo(() => {
    const first = recent[0]?.t;
    if (!older?.length || !first) return recent;
    const before = older.filter((c) => c.t < first);
    return before.length ? [...before, ...recent] : recent;
  }, [older, recent]);
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
  const [storedInd, setIndicators] = usePersisted<Indicator[]>('watchlist.velas.indicadores', DEFAULT_INDICATORS, isIndicators);
  // Lo guardado puede venir en el formato antiguo de las medias: se lee ya normalizado.
  const indicators = useMemo(() => storedInd.map((i) => normalizeIndicator(i)!), [storedInd]);
  // Quien ya tenía indicadores guardados de antes del volumen lo recibe una vez, como los nuevos.
  useEffect(() => {
    if (localStorage.getItem(VOLUME_ADDED_KEY)) return;
    localStorage.setItem(VOLUME_ADDED_KEY, '1');
    if (!storedInd.some((i) => i.kind === 'volume')) setIndicators([...storedInd, VOLUME_INDICATOR]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [indQuery, setIndQuery] = useState('');
  const [magnet, setMagnet] = usePersisted<boolean>('watchlist.velas.iman', false, (v) => typeof v === 'boolean');
  /** La escala de precios se abre hasta que se ven todas las líneas: compras, orden, objetivos y horizontales dibujadas. */
  const [fitLines, setFitLines] = usePersisted<boolean>('watchlist.velas.todasLineas', false, (v) => typeof v === 'boolean');
  const [stay, setStay] = useState(false);
  const [lockAll, setLockAll] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [tool, setTool] = useState<Tool>('cursor');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<ChartPoint[]>([]);
  const [groupTool, setGroupTool] = useState<Record<string, DrawTool>>({});
  const [flyout, setFlyout] = useState<{ group: string; top: number } | null>(null);
  /** Menú del clic derecho: posición dentro del gráfico y precio bajo el cursor. */
  const [menu, setMenu] = useState<{ x: number; y: number; price: number | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [indOpen, setIndOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const kind: ChartType = flat && chartType === 'candles' ? 'line' : chartType;
  const intradayBars = intradayQ.data?.candles ?? NO_CANDLES;
  /** Intervalo de lo que se pinta (un fondo en intradía se ve en diario). */
  const shown: Step = intraday || !isIntraday(step) ? step : 'D';
  const bars = useMemo(() => (intraday ? intradayBars : aggregate(candles, shown)), [candles, intradayBars, intraday, shown]);
  // Todos los decimales que trae el precio: si cotiza a 14,6083, el gráfico no lo redondea a 14,61.
  const precision = useMemo(() => pricePrecision(bars, quoted, liveQuote?.price), [bars, quoted, liveQuote?.price]);
  // Sin volumen (fondos, datos sin él) su panel no sale vacío.
  const withVolume = useMemo(() => hasVolume(bars), [bars]);
  const visibleInd = useMemo(
    () => indicators.filter((i) => !i.hidden && (i.kind !== 'volume' || withVolume)),
    [indicators, withVolume],
  );
  /** Cifras de cada indicador visible, por línea y alineadas con las velas. */
  const indData = useMemo(
    () => new Map(visibleInd.map((ind) => [ind.id, INDICATOR_DEFS[ind.kind].compute(bars, ind.params)])),
    [bars, visibleInd],
  );
  // Las series y los paneles se rehacen solo si cambia qué se ve o su color; los parámetros solo cambian datos.
  const indKey = visibleInd.map((i) => `${i.id}:${i.kind}:${i.color}`).join('|');
  const returns = useMemo(() => new Map(PERIODS.map(([id]) => [id, periodReturn(candles, id)])), [candles]);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const primRef = useRef(new DrawingsPrimitive());
  // Sube cada vez que se crea la serie: lo que se pinta sobre ella (las marcas) se vuelve a poner.
  const [seriesGen, bumpSeries] = useReducer((n: number) => n + 1, 0);
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const indSeriesRef = useRef<IndSeries[]>([]);
  const datesRef = useRef<string[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const fittedRef = useRef(false);
  /** Encuadre pendiente de que el gráfico tenga ancho. */
  const needFitRef = useRef(false);
  const fitRef = useRef<() => void>(() => {});
  /** Serie que tiene cargadas las velas: si es otra (gráfico recién creado), se cargan enteras. */
  const dataSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  /** Precios que la escala debe abarcar (con «Ver todas las líneas»), o null. */
  const fitPricesRef = useRef<number[] | null>(null);
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
  // Gráfico y serie: se crean de nuevo si cambia el tipo (velas o línea), conservando el encuadre.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !hasData) return;
    const colors = themeColors();
    const chart = createChart(box, {
      autoSize: true,
      // El logo de TradingView dentro del gráfico es la atribución que pide su licencia.
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: colors.text, fontFamily: 'inherit', attributionLogo: true },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, rightOffset: RIGHT_OFFSET, minBarSpacing: 0.05 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'es-ES' },
    });
    const series: ISeriesApi<SeriesType> = kind === 'line'
      ? chart.addSeries(LineSeries, { ...mainSeriesOptions(kind, colors), lineWidth: 2 })
      : chart.addSeries(CandlestickSeries, mainSeriesOptions(kind, colors));
    const prim = primRef.current;
    prim.colors = { text: colors.text, up: colors.up, down: colors.down };
    series.attachPrimitive(prim);
    // La escala automática abarca además las líneas fijas cuando se pide verlas todas.
    series.applyOptions({
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const info = base();
        const extra = fitPricesRef.current;
        if (!info?.priceRange || !extra?.length) return info;
        const { minValue, maxValue } = info.priceRange;
        return { ...info, priceRange: { minValue: Math.min(minValue, ...extra), maxValue: Math.max(maxValue, ...extra) } };
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    bumpSeries();
    fittedRef.current = false;
    const onSize = (width: number) => {
      if (width > 0 && needFitRef.current) {
        needFitRef.current = false;
        fitRef.current();
      }
    };
    chart.timeScale().subscribeSizeChange(onSize);

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
    // Con osciladores debajo, solo cuenta el panel de arriba.
    const inPane = (x: number, y: number) =>
      x >= 0 && y >= 0 && x <= chart.timeScale().width() && y <= (chart.panes()[0]?.getHeight() ?? box.clientHeight - chart.timeScale().height());

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
      chart.timeScale().unsubscribeSizeChange(onSize);
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
  fitRef.current = () => showPeriod(period);

  // Al acercarse al principio de lo cargado (o pedir «Máx»), se trae toda la historia del valor.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || wantAll) return;
    const ts = chart.timeScale();
    const onRange = (r: LogicalRange | null) => {
      if (r && r.from < 30 && !isIntraday(stepRef.current)) setWantAllOf(symbol);
    };
    ts.subscribeVisibleLogicalRangeChange(onRange);
    return () => ts.unsubscribeVisibleLogicalRangeChange(onRange);
  }, [hasData, kind, symbol, wantAll]);

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
    const prevFirst = datesRef.current[0];
    const prev = barsRef.current;
    const before = chart.timeScale().getVisibleLogicalRange();
    datesRef.current = bars.map((b) => b.t);
    barsRef.current = bars;
    const prim = primRef.current;
    prim.dates = datesRef.current;
    prim.step = shown;
    prim.precision = precision;
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    const point = (c: Candle) => (kind === 'candles'
      ? { time: chartTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c }
      : { time: chartTime(c.t), value: c.c });
    // Precio en directo: solo cambia (o se añade) la última vela, que se actualiza sin volver a cargar toda la serie.
    const grown = bars.length - prev.length;
    const tick = dataSeriesRef.current === series && stepRef.current === shown && prev.length > 1 && (grown === 0 || grown === 1)
      && bars[0]!.t === prev[0]!.t && sameBar(bars[prev.length - 2]!, prev[prev.length - 2]!);
    if (tick) for (const c of bars.slice(prev.length - 1)) (series as ISeriesApi<'Candlestick' | 'Line'>).update(point(c) as never);
    else (series as ISeriesApi<'Candlestick' | 'Line'>).setData(bars.map(point) as never);
    dataSeriesRef.current = series;
    // Al llegar la historia antigua, las barras se anteponen: se corre el zoom para que no salte.
    const added = prevFirst && stepRef.current === shown && bars[0]!.t < prevFirst ? bars.findIndex((b) => b.t >= prevFirst) : 0;
    if (fittedRef.current && added > 0) {
      if (period === 'max') showPeriod('max');
      else if (before) chart.timeScale().setVisibleLogicalRange({ from: before.from + added, to: before.to + added });
    }
    if (!fittedRef.current || stepRef.current !== shown) {
      const saved = savedRangeRef.current;
      if (!fittedRef.current && saved && stepRef.current === shown) chart.timeScale().setVisibleLogicalRange(saved);
      // Sin ancho todavía (el detalle se está colocando), el encuadre espera a que lo tenga: si no, las velas
      // quedarían apretadas en una franja de unos píxeles.
      else if (chart.timeScale().width() === 0) needFitRef.current = true;
      else showPeriod(period);
      fittedRef.current = true;
      stepRef.current = shown;
      savedRangeRef.current = null;
    }
    prim.update();
    // El gráfico puede nacer después que los datos (p. ej. velas de 5m ya guardadas y las diarias aún de camino):
    // por eso también corre al crearse, y no solo al cambiar las velas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, kind, hasData, symbol, precision]);

  // Compras y ventas: una flecha en la vela que contiene su fecha (con velas semanales o mensuales, varias se juntan).
  const marksKey = JSON.stringify(marks ?? []);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !marks?.length || !bars.length) return;
    const c = themeColors();
    const days = bars.map((b) => b.t.slice(0, 10));
    const grouped = new Map<string, { bar: number; side: ChartMark['side']; n: number }>();
    for (const m of marks) {
      if (m.date < days[0]!) continue;
      let lo = 0;
      let hi = days.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (days[mid]! <= m.date) lo = mid;
        else hi = mid - 1;
      }
      const key = `${lo}-${m.side}`;
      const g = grouped.get(key) ?? { bar: lo, side: m.side, n: 0 };
      g.n++;
      grouped.set(key, g);
    }
    const out: SeriesMarker<Time>[] = [...grouped.values()]
      .sort((a, b) => a.bar - b.bar)
      .map((g) => ({
        time: chartTime(bars[g.bar]!.t),
        position: g.side === 'buy' ? 'belowBar' : 'aboveBar',
        shape: g.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: g.side === 'buy' ? c.up : c.down,
        text: `${g.side === 'buy' ? 'C' : 'V'}${g.n > 1 ? ` ×${g.n}` : ''}`,
        size: 2,
      }));
    const plugin = createSeriesMarkers(series, out);
    return () => plugin.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, seriesGen, marksKey]);

  // Indicadores: los de precio encima de las velas y cada oscilador en su panel, debajo.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const r of indSeriesRef.current) for (const se of r.lines.values()) chart.removeSeries(se);
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    let sub = 0;
    indSeriesRef.current = visibleInd.map((ind) => {
      const def = INDICATOR_DEFS[ind.kind];
      const pane = def.pane === 'sub' ? ++sub : 0;
      const digits = def.precision ?? precision;
      const common = {
        priceLineVisible: false, lastValueVisible: def.pane === 'sub', crosshairMarkerVisible: false,
        priceFormat: def.format === 'volume'
          ? { type: 'volume' as const }
          : { type: 'price' as const, precision: digits, minMove: 10 ** -digits },
      };
      const lines = new Map<string, ISeriesApi<'Line' | 'Histogram'>>();
      for (const l of def.lines) {
        const color = l.color ?? ind.color;
        lines.set(
          l.key,
          l.style === 'histogram'
            ? chart.addSeries(HistogramSeries, { ...common, color }, pane)
            : chart.addSeries(LineSeries, {
                ...common, color, lineWidth: (l.width ?? 1) as 1 | 2,
                lineStyle: l.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
                lineVisible: l.style !== 'dots', pointMarkersVisible: l.style === 'dots', pointMarkersRadius: 1.6,
              }, pane),
        );
      }
      const first = lines.get(def.lines.find((l) => l.style !== 'histogram')!.key)!;
      for (const v of def.levels ?? []) first.createPriceLine({ price: v, color: LEVEL_COLOR, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      const range = def.range;
      if (range) first.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: range[0], maxValue: range[1] } }) });
      let fill: BandFillPrimitive | null = null;
      if (def.fill) {
        fill = new BandFillPrimitive();
        lines.get(def.fill.a)!.attachPrimitive(fill);
      }
      // Osciladores con zona de sobrecompra y sobreventa: la franja entre las dos referencias, sombreada.
      let band: BandFillPrimitive | null = null;
      if (def.levels?.length === 2) {
        band = new BandFillPrimitive();
        first.attachPrimitive(band);
      }
      return { ind, def, lines, fill, band };
    });
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 1 : SUB_STRETCH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indKey, hasData, kind, symbol]);

  useEffect(() => {
    for (const { ind, def, lines, fill, band } of indSeriesRef.current) {
      const values = indData.get(ind.id);
      if (!values) continue;
      for (const [key, se] of lines) {
        const line = def.lines.find((l) => l.key === key);
        const hist = line?.style === 'histogram';
        const up = (v: number, i: number) => (line?.tone === 'candle' ? bars[i]!.c >= bars[i]!.o : v >= 0);
        se.setData((values[key] ?? []).flatMap((v, i) =>
          v == null ? [] : [hist ? { time: chartTime(bars[i]!.t), value: v, color: up(v, i) ? HIST_UP : HIST_DOWN } : { time: chartTime(bars[i]!.t), value: v }],
        ));
      }
      if (band && def.levels) band.set(bars.map(() => def.levels![1]!), bars.map(() => def.levels![0]!), alpha(ind.color, 0.08));
      if (fill && def.fill) fill.set(values[def.fill.a] ?? [], values[def.fill.b] ?? [], def.fill.up ?? alpha(ind.color, 0.1), def.fill.down);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indData, indKey, hasData, kind, symbol]);

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
    levelLinesRef.current = lines.map((l) => series.createPriceLine({
      price: l.price,
      color: lineColor(l, colors),
      lineWidth: 1,
      lineStyle: l.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true, title: l.title,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- las líneas cambian cuando cambia su contenido
  }, [linesKey, hasData, kind]);

  // «Ver todas las líneas»: precios de las líneas fijas y de las horizontales dibujadas que la escala debe abarcar.
  const fitKey = fitLines
    ? [...lines.map((l) => l.price), ...drawings.filter((d) => d.type === 'hline' || d.type === 'hray').map((d) => d.points[0]!.p)].join(',')
    : '';
  useEffect(() => {
    const chart = chartRef.current;
    fitPricesRef.current = fitKey ? fitKey.split(',').map(Number) : null;
    // Vuelve la escala automática (si se había estirado a mano) para que tome las líneas al momento.
    chart?.priceScale('right').applyOptions({ autoScale: true });
  }, [fitKey, hasData, kind]);

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
    if (!flyout && !indOpen && !menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.xp-candles__flyout, .xp-candles__panel, [data-popover]')) {
        setFlyout(null);
        setIndOpen(false);
        setMenu(null);
      }
    };
    const onLeave = () => setMenu(null);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', onLeave);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', onLeave);
    };
  }, [flyout, indOpen, menu]);

  // El menú del clic derecho no se sale del gráfico: si no cabe, se abre hacia la izquierda o hacia arriba.
  useLayoutEffect(() => {
    const el = menuRef.current;
    const stage = stageRef.current;
    if (!menu || !el || !stage) return;
    const x = menu.x + el.offsetWidth > stage.clientWidth - 4 ? Math.max(4, menu.x - el.offsetWidth) : menu.x;
    const y = menu.y + el.offsetHeight > stage.clientHeight - 4 ? Math.max(4, stage.clientHeight - el.offsetHeight - 4) : menu.y;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
  }, [menu]);

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
  /** Vuelve a la vista del periodo elegido, con las escalas de precio ajustadas solas (como Alt+R en TradingView). */
  const resetView = () => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const pane of chart.panes()) pane.priceScale('right').applyOptions({ autoScale: true });
    showPeriod(period);
  };
  const priceText = (p: number) => p.toFixed(precision).replace('.', ',');
  const openMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const stage = stageRef.current?.getBoundingClientRect();
    const box = boxRef.current?.getBoundingClientRect();
    if (!stage || !box) return;
    const p = seriesRef.current?.coordinateToPrice(e.clientY - box.top);
    setFlyout(null);
    setIndOpen(false);
    setMenu({ x: e.clientX - stage.left, y: e.clientY - stage.top, price: p == null || !Number.isFinite(p) ? null : p });
  };
  /** Ejecuta la opción del menú y lo cierra, devolviendo el foco al gráfico para seguir con el teclado. */
  const pick = (fn: () => void) => () => {
    setMenu(null);
    rootRef.current?.focus({ preventScroll: true });
    fn();
  };
  const menuKeys = (e: React.KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      rootRef.current?.focus({ preventScroll: true });
    }
  };
  const openFlyout = (group: string, el: HTMLElement) => {
    if (flyout?.group === group) return setFlyout(null);
    const top = el.getBoundingClientRect().top - (stageRef.current?.getBoundingClientRect().top ?? 0);
    setFlyout({ group, top });
  };
  const updateIndicator = (id: string, patch: Partial<Indicator>) =>
    setIndicators(indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const newIndicator = (kind: IndKind, n: number, params?: Record<string, number>, color?: string): Indicator => ({
    id: newDrawingId(), kind, params: { ...defaultParams(kind), ...params }, color: color ?? IND_COLORS[n % IND_COLORS.length]!,
  });
  const addIndicator = (kind: IndKind) => setIndicators([...indicators, newIndicator(kind, indicators.length)]);
  /** Plantilla: añade lo que falte (un indicador igual que ya está no se repite, solo se vuelve a mostrar). */
  const applyTemplate = (items: (typeof TEMPLATES)[number]['items']) => {
    const next = [...indicators];
    for (const it of items) {
      const cand = newIndicator(it.kind, next.length, it.params, it.color);
      const at = next.findIndex((i) => i.kind === cand.kind && JSON.stringify(i.params) === JSON.stringify(cand.params));
      if (at >= 0) next[at] = { ...next[at]!, hidden: false };
      else next.push(cand);
    }
    setIndicators(next);
  };
  const q = fold(indQuery.trim());
  const catalog = IND_GROUPS.map(([g, label]) => ({
    g, label, items: IND_LIST.filter((d) => d.group === g && (!q || fold(`${d.name} ${d.short} ${label}`).includes(q))),
  })).filter((c) => c.items.length);

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
    } else if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyR') {
      e.preventDefault();
      resetView();
    } else if (e.altKey && !mod) {
      const t = e.shiftKey ? (e.code === 'KeyR' ? 'rect' : undefined) : SHORTCUTS[e.code];
      if (t) {
        e.preventDefault();
        chooseTool(t);
      }
    }
  };

  const toolTitle = (t: DrawTool) => (TOOL_INFO[t][1] ? `${TOOL_INFO[t][0]} (${TOOL_INFO[t][1]})` : TOOL_INFO[t][0]);
  // Sin instrucciones de uso de las herramientas: solo avisos de datos o de guardado.
  const notes = [
    (intraday ? intradayQ.data?.stale : candlesQ.data?.stale) && 'Datos guardados: la fuente no responde',
    save.isError && 'No se pudo guardar el dibujo',
  ].filter((n): n is string => !!n);
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
          {tvSymbol && (
            <a
              href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
              target="_blank"
              rel="noreferrer"
              title="Abrir en TradingView"
              aria-label="Abrir en TradingView"
            >
              <svg width="20" height="16" viewBox="0 0 36 28" fill="currentColor" aria-hidden="true">
                <path d="M14 22H7V11H0V4h14v18zM28 22h-8l7.5-18h8L28 22z" />
                <circle cx="20" cy="8" r="4" />
              </svg>
            </a>
          )}
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
          {toggle('fitLines', 'Ver todas las líneas: órdenes, compras, objetivos y consenso', fitLines, () => setFitLines(!fitLines))}
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
            onContextMenu={hasData ? openMenu : undefined}
            aria-label={`Gráfico de velas de ${name}`}
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
            <Legend name={name} step={shown} bars={bars} flat={flat} indicators={visibleInd} indData={indData} precision={precision} setter={legendRef} />
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

        {menu && (
          <div
            ref={menuRef}
            className="xp-candles__flyout xp-candles__menu"
            role="menu"
            aria-label="Opciones del gráfico"
            style={{ left: menu.x, top: menu.y }}
            onKeyDown={menuKeys}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button type="button" role="menuitem" onClick={pick(resetView)}>
              <ChartIcon name="reset" /><span>Restablecer visualización del gráfico</span><kbd>Alt + R</kbd>
            </button>
            {menu.price != null && (
              <button type="button" role="menuitem" onClick={pick(() => void navigator.clipboard?.writeText(priceText(menu.price!)))}>
                <ChartIcon name="copy" /><span>Copiar precio {priceText(menu.price)}</span>
              </button>
            )}
            <hr />
            <button type="button" role="menuitem" onClick={pick(() => zoom(0.7))}>
              <ChartIcon name="zoomIn" /><span>Acercar</span>
            </button>
            <button type="button" role="menuitem" onClick={pick(() => zoom(1 / 0.7))}>
              <ChartIcon name="zoomOut" /><span>Alejar</span>
            </button>
            {(drawings.length > 0 || indicators.length > 0) && <hr />}
            {drawings.length > 0 && (
              <button type="button" role="menuitem" onClick={pick(() => { setHidden(!hidden); setSelected(null); })}>
                <ChartIcon name="eye" /><span>{hidden ? 'Mostrar dibujos' : 'Ocultar dibujos'}</span>
              </button>
            )}
            {drawings.length > 0 && (
              <button type="button" role="menuitem" onClick={pick(removeAll)}>
                <ChartIcon name="trash" /><span>Eliminar {drawings.length === 1 ? 'el dibujo' : `${drawings.length} dibujos`}</span>
              </button>
            )}
            {indicators.length > 0 && (
              <button type="button" role="menuitem" onClick={pick(() => setIndicators([]))}>
                <ChartIcon name="indicators" /><span>Eliminar {indicators.length === 1 ? 'el indicador' : `${indicators.length} indicadores`}</span>
              </button>
            )}
            <hr />
            <button type="button" role="menuitem" onClick={pick(screenshot)}>
              <ChartIcon name="camera" /><span>Descargar imagen</span>
            </button>
            <button type="button" role="menuitem" onClick={pick(toggleFull)}>
              <ChartIcon name="fullscreen" /><span>{full ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>
            </button>
          </div>
        )}

        {indOpen && (
          <div className="xp-candles__panel xp-ind" role="dialog" aria-label="Indicadores">
            <input
              type="search"
              className="xp-ind__search"
              placeholder="Buscar: RSI, Bollinger, media…"
              aria-label="Buscar indicador"
              value={indQuery}
              autoFocus
              onChange={(e) => setIndQuery(e.target.value)}
            />
            <div className="xp-ind__templates" role="group" aria-label="Plantillas">
              <span className="muted small">Plantillas</span>
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="btn btn--small" title={t.title} onClick={() => applyTemplate(t.items)}>
                  {t.label}
                </button>
              ))}
            </div>
            {indicators.length > 0 && (
              <section className="xp-ind__section">
                <div className="xp-ind__title">
                  <strong className="small">En el gráfico</strong>
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => setIndicators([])}>Quitar todos</button>
                </div>
                {indicators.map((ind) => (
                  <IndicatorRow
                    key={ind.id}
                    ind={ind}
                    def={INDICATOR_DEFS[ind.kind]}
                    onChange={(patch) => updateIndicator(ind.id, patch)}
                    onRemove={() => setIndicators(indicators.filter((i) => i.id !== ind.id))}
                  />
                ))}
              </section>
            )}
            <div className="xp-ind__catalog">
              {catalog.map(({ g, label, items }) => (
                <section key={g} className="xp-ind__section">
                  <strong className="small muted">{label}</strong>
                  {items.map((d) => (
                    <button key={d.kind} type="button" className="xp-ind__add" onClick={() => addIndicator(d.kind)}>
                      <span>{d.name}</span>
                      <small className="muted">{d.short}{d.pane === 'sub' ? ' · panel' : ''}</small>
                      <b aria-hidden="true">+</b>
                    </button>
                  ))}
                </section>
              ))}
              {catalog.length === 0 && <p className="muted small">Ningún indicador con «{indQuery.trim()}».</p>}
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

      {/* Solo cuando hay algo que decir: la herramienta en curso, el dibujo elegido o un problema. */}
      {notes.length > 0 && <p className="muted small xp-candles__note">{notes.join(' · ')}</p>}
    </div>
  );
}

interface LegendProps {
  name: string;
  step: Step;
  bars: Candle[];
  flat: boolean;
  indicators: Indicator[];
  indData: Map<string, Record<string, Series>>;
  precision: number;
  setter: MutableRefObject<((i: number | null) => void) | null>;
}

/** Leyenda de arriba a la izquierda: la vela bajo el cursor (o la última) y el valor de las medias. */
function Legend({ name, step, bars, flat, indicators, indData, precision, setter }: LegendProps) {
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
      {indicators.map((ind) => {
        const def = INDICATOR_DEFS[ind.kind];
        const values = indData.get(ind.id);
        const d = def.precision ?? precision;
        return (
          <div key={ind.id} style={{ color: ind.color }}>
            {indicatorLabel(ind)}
            {def.lines.map((l) => {
              const v = values?.[l.key]?.[i];
              return (
                <b key={l.key} style={{ color: l.color ?? ind.color }}>
                  {' '}{v == null ? '—' : def.format === 'volume' ? fmtVolume(v) : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })}
                </b>
              );
            })}
          </div>
        );
      })}
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

interface IndSeries {
  ind: Indicator;
  def: IndicatorDef;
  lines: Map<string, ISeriesApi<'Line' | 'Histogram'>>;
  fill: BandFillPrimitive | null;
  band: BandFillPrimitive | null;
}

/** Un indicador puesto: color, nombre, sus parámetros, ocultar y quitar. */
function IndicatorRow({ ind, def, onChange, onRemove }: { ind: Indicator; def: IndicatorDef; onChange: (p: Partial<Indicator>) => void; onRemove: () => void }) {
  return (
    <div className={`xp-ind__row${ind.hidden ? ' xp-ind__row--off' : ''}`}>
      <input type="color" className="xp-ind__color" aria-label={`Color de ${def.name}`} value={ind.color} onChange={(e) => onChange({ color: e.target.value })} />
      <span className="xp-ind__name" title={def.name}>{def.short}</span>
      <span className="xp-ind__params">
        {def.params.map((p) => (
          <input
            key={p.key}
            type="number"
            title={p.label}
            aria-label={`${def.short}: ${p.label}`}
            min={p.min}
            max={p.max}
            step={p.step}
            value={ind.params[p.key]}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (e.target.value !== '' && n >= p.min && n <= p.max) onChange({ params: { ...ind.params, [p.key]: n } });
            }}
          />
        ))}
      </span>
      <button type="button" className="icon-btn" aria-pressed={!ind.hidden} title={ind.hidden ? 'Mostrar' : 'Ocultar'} aria-label={ind.hidden ? 'Mostrar' : 'Ocultar'} onClick={() => onChange({ hidden: !ind.hidden })}>
        <ChartIcon name="eye" />
      </button>
      <button type="button" className="icon-btn" title="Quitar" aria-label={`Quitar ${def.name}`} onClick={onRemove}>
        <ChartIcon name="trash" />
      </button>
    </div>
  );
}
