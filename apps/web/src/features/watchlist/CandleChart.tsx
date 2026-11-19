import type { Candle, ChartDrawing, ChartPoint, WatchlistRow } from '@watchlist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type Logical,
  type MouseEventParams,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import {
  channelOffset,
  DEFAULT_DRAWING_COLOR,
  distToSegment,
  DRAWING_COLORS,
  fromLogical,
  insidePolygon,
  newDrawingId,
  toLogical,
  TOOL_POINTS,
  type Tool,
} from './chartDrawing.ts';

const RANGES = [['3m', '3M', 63], ['6m', '6M', 126], ['1y', '1A', 252], ['5y', '5A', 1300]] as const;
type RangeId = (typeof RANGES)[number][0];
const RANGE_KEY = 'watchlist.velas.periodo';
const HIT_PX = 7;
const NO_DRAWINGS: ChartDrawing[] = [];
const NO_CANDLES: Candle[] = [];

const TOOLS: [Tool, string, string][] = [
  ['cursor', 'Cursor', 'Seleccionar y mover el gráfico'],
  ['hline', 'Horizontal', 'Soporte o resistencia: un clic en el precio'],
  ['trend', 'Tendencia', 'Línea de tendencia: dos clics'],
  ['channel', 'Canal', 'Canal: dos clics para la línea base y un tercero para la paralela'],
];

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

const precisionFor = (price: number) => (price < 1 ? 4 : price < 10 ? 3 : 2);

interface Preview {
  type: 'trend' | 'channel';
  points: ChartPoint[];
  cursor: ChartPoint | null;
}

interface MediaTarget {
  useMediaCoordinateSpace: (cb: (scope: { context: CanvasRenderingContext2D }) => void) => void;
}

/** Dibuja tendencias y canales en el lienzo del gráfico (las horizontales son líneas de precio del propio gráfico). */
class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  drawings: ChartDrawing[] = [];
  selected: string | null = null;
  preview: Preview | null = null;
  dates: string[] = [];
  private param: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target as unknown as MediaTarget) };
    this.view = { renderer: () => renderer, zOrder: () => 'top' };
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) { this.param = param; }
  detached() { this.param = null; }
  paneViews() { return [this.view]; }
  update() { this.param?.requestUpdate(); }

  /** Coordenadas en pantalla de un punto (null si su precio no cabe en la escala). */
  xy(point: ChartPoint): [number, number] | null {
    if (!this.param) return null;
    const x = this.param.chart.timeScale().logicalToCoordinate(toLogical(this.dates, point.t) as Logical);
    const y = this.param.series.priceToCoordinate(point.p);
    return x == null || y == null ? null : [x, y];
  }

  /** Segmentos en pantalla de un dibujo: la línea (o las dos del canal). */
  segments(d: { type: ChartDrawing['type']; points: ChartPoint[] }): [number, number, number, number][] {
    const [a, b, c] = d.points;
    if (!a || !b) return [];
    const pa = this.xy(a);
    const pb = this.xy(b);
    if (!pa || !pb) return [];
    const out: [number, number, number, number][] = [[...pa, ...pb]];
    if (d.type === 'channel' && c) {
      const off = channelOffset(this.dates, [a, b, c]);
      const qa = this.xy({ t: a.t, p: a.p + off });
      const qb = this.xy({ t: b.t, p: b.p + off });
      if (qa && qb) out.push([...qa, ...qb]);
    }
    return out;
  }

  private draw(target: MediaTarget) {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      const paint = (d: { type: ChartDrawing['type']; points: ChartPoint[] }, color: string, selected: boolean) => {
        const segs = this.segments(d);
        if (!segs.length) return;
        if (segs.length === 2) {
          const [s, t] = segs as [[number, number, number, number], [number, number, number, number]];
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.lineTo(t[2], t[3]); ctx.lineTo(t[0], t[1]);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.6;
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo((s[0] + t[0]) / 2, (s[1] + t[1]) / 2);
          ctx.lineTo((s[2] + t[2]) / 2, (s[3] + t[3]) / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 3 : 2;
        for (const [x1, y1, x2, y2] of segs) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        if (selected) {
          ctx.fillStyle = '#fff';
          for (const p of d.points) {
            const xy = this.xy(p);
            if (!xy) continue;
            ctx.beginPath();
            ctx.arc(xy[0], xy[1], 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      };
      for (const d of this.drawings) {
        if (d.type !== 'hline') paint(d, d.color ?? DEFAULT_DRAWING_COLOR, d.id === this.selected);
      }
      const pv = this.preview;
      if (pv && pv.cursor) {
        const pts = [...pv.points, pv.cursor];
        // Con un solo punto fijado, el canal se ve como su línea base.
        paint({ type: pts.length >= 3 ? 'channel' : 'trend', points: pts }, DEFAULT_DRAWING_COLOR, true);
      }
    });
  }
}

interface Props {
  row: WatchlistRow;
  /** Símbolo de TradingView, si lo tiene: para el enlace de abrirlo allí. */
  tvSymbol: string | null;
}

/**
 * Gráfico de velas diarias (Lightweight Charts, de TradingView) con datos al día y dibujos guardados en
 * la cuenta: soportes y resistencias, líneas de tendencia y canales. Las compras de la lista salen
 * como líneas discontinuas.
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

  const [tool, setTool] = useState<Tool>('cursor');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<ChartPoint[]>([]);
  const [range, setRange] = useState<RangeId>(() => (RANGES.some(([id]) => id === localStorage.getItem(RANGE_KEY)) ? localStorage.getItem(RANGE_KEY) as RangeId : '1y'));

  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const primRef = useRef(new DrawingsPrimitive());
  const hlinesRef = useRef(new Map<string, IPriceLine>());
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const datesRef = useRef<string[]>([]);
  const fittedRef = useRef(false);
  // Lo último de cada estado para los manejadores del gráfico, que se suscriben una sola vez.
  const live = useRef({ tool, pending, drawings, selected });
  live.current = { tool, pending, drawings, selected };

  const commit = (next: ChartDrawing[]) => save.mutate(next);

  // Gráfico y serie: se crean de nuevo solo si cambia el tipo (velas o línea, en los fondos).
  const hasData = candles.length > 0;
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !hasData) return;
    const colors = themeColors();
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: colors.text, fontFamily: 'inherit' },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, rightOffset: 8 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'es-ES' },
    });
    const series = flat
      ? chart.addSeries(LineSeries, { color: colors.accent, lineWidth: 2 })
      : chart.addSeries(CandlestickSeries, {
        upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
        wickUpColor: colors.up, wickDownColor: colors.down,
      });
    const prim = primRef.current;
    series.attachPrimitive(prim);
    chartRef.current = chart;
    seriesRef.current = series;
    fittedRef.current = false;
    const hlines = hlinesRef.current;

    // Tema claro/oscuro: se repintan los colores al cambiarlo.
    const retheme = () => {
      const c = themeColors();
      chart.applyOptions({
        layout: { textColor: c.text },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.grid },
        timeScale: { borderColor: c.grid },
      });
      if (flat) series.applyOptions({ color: c.accent });
      else series.applyOptions({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    };
    const observer = new MutationObserver(retheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', retheme);

    /** Punto del gráfico (fecha y precio) en unas coordenadas del panel. */
    const pointAt = (x: number, y: number, logical?: number | null): ChartPoint | null => {
      const l = logical ?? chart.timeScale().coordinateToLogical(x);
      const p = series.coordinateToPrice(y);
      return l == null || p == null ? null : { t: fromLogical(datesRef.current, l), p: Number(p.toPrecision(7)) };
    };

    const onClick = (x: number, y: number) => {
      const { tool: t, pending: pend, drawings: all } = live.current;
      if (t === 'cursor') {
        const hit = [...all].reverse().find((d) => {
          if (d.type === 'hline') {
            const yy = series.priceToCoordinate(d.price);
            return yy != null && Math.abs(yy - y) <= HIT_PX;
          }
          const segs = prim.segments(d);
          if (segs.some((s) => distToSegment(x, y, ...s) <= HIT_PX)) return true;
          // Un canal también se elige pulsando entre sus dos líneas.
          const [a, b] = segs;
          return !!a && !!b && insidePolygon(x, y, [[a[0], a[1]], [a[2], a[3]], [b[2], b[3]], [b[0], b[1]]]);
        });
        setSelected(hit?.id ?? null);
        return;
      }
      const point = pointAt(x, y);
      if (!point) return;
      const pts = [...pend, point];
      if (pts.length < TOOL_POINTS[t]) {
        setPending(pts);
        return;
      }
      const id = newDrawingId();
      const drawing: ChartDrawing = t === 'hline'
        ? { id, type: 'hline', price: point.p }
        : t === 'trend'
          ? { id, type: 'trend', points: [pts[0]!, pts[1]!] }
          : { id, type: 'channel', points: [pts[0]!, pts[1]!, pts[2]!] };
      commit([...all, drawing]);
      setPending([]);
      setTool('cursor');
      setSelected(id);
    };
    const onMove = (param: MouseEventParams<Time>) => {
      const { tool: t, pending: pend } = live.current;
      if (t !== 'trend' && t !== 'channel') return;
      prim.preview = pend.length && param.point ? { type: t, points: pend, cursor: pointAt(param.point.x, param.point.y, param.logical) } : null;
      prim.update();
    };
    // Los clics se leen del puntero y no de subscribeClick: el gráfico se traga el segundo clic si llega
    // rápido (lo toma por un doble clic fallido), y al dibujar se hacen clics seguidos en sitios distintos.
    // Un arrastre (mover el gráfico) no cuenta como clic.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) return;
      down = null;
      const rect = box.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Fuera del panel de precios (en los ejes) no se dibuja ni se selecciona.
      if (x < 0 || y < 0 || x > chart.timeScale().width() || y > box.clientHeight - chart.timeScale().height()) return;
      onClick(x, y);
    };
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointerup', onUp);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', retheme);
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('pointerup', onUp);
      chart.unsubscribeCrosshairMove(onMove);
      hlines.clear();
      levelLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // commit/setters son estables a efectos del gráfico: leen el estado por `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, flat, symbol]);

  // Datos: se actualizan sin perder el zoom; la primera vez se encuadra el periodo elegido.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candles.length) return;
    datesRef.current = candles.map((c) => c.t);
    primRef.current.dates = datesRef.current;
    const precision = precisionFor(candles.at(-1)!.c);
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    if (flat) (series as ISeriesApi<'Line'>).setData(candles.map((c: Candle) => ({ time: c.t as Time, value: c.c })));
    else (series as ISeriesApi<'Candlestick'>).setData(candles.map((c: Candle) => ({ time: c.t as Time, open: c.o, high: c.h, low: c.l, close: c.c })));
    if (!fittedRef.current) {
      fittedRef.current = true;
      showRange(range);
    }
    primRef.current.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, flat]);

  const showRange = (id: RangeId) => {
    const chart = chartRef.current;
    const n = datesRef.current.length;
    if (!chart || !n) return;
    const bars = RANGES.find(([r]) => r === id)![2];
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to: n - 1 + 8 });
  };

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
  }, [metrics.levels, item.orderActive, item.orderPrice, hasData, flat]);

  // Dibujos: horizontales como líneas de precio; tendencias y canales en el lienzo.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines = hlinesRef.current;
    for (const l of lines.values()) series.removePriceLine(l);
    lines.clear();
    for (const d of drawings) {
      if (d.type !== 'hline') continue;
      lines.set(d.id, series.createPriceLine({
        price: d.price, color: d.color ?? DEFAULT_DRAWING_COLOR, lineWidth: d.id === selected ? 3 : 2,
        lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '',
      }));
    }
    const prim = primRef.current;
    prim.drawings = drawings;
    prim.selected = selected;
    if (tool === 'cursor' || !pending.length) prim.preview = null;
    prim.update();
  }, [drawings, selected, tool, pending, hasData, flat]);

  const chooseTool = (t: Tool) => {
    setTool(t);
    setPending([]);
    if (t !== 'cursor') setSelected(null);
  };
  const removeSelected = () => {
    if (!selected) return;
    commit(drawings.filter((d) => d.id !== selected));
    setSelected(null);
  };
  const recolor = (color: string) => {
    if (selected) commit(drawings.map((d) => (d.id === selected ? { ...d, color } : d)));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') chooseTool('cursor');
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      removeSelected();
    }
  };

  const needed = tool === 'cursor' ? 0 : TOOL_POINTS[tool];
  const hint = tool === 'cursor'
    ? selected ? 'Dibujo seleccionado: Supr para borrarlo.' : 'Pulsa un dibujo para seleccionarlo.'
    : `Haz clic en el gráfico: punto ${pending.length + 1} de ${needed}. Esc para cancelar.`;
  const selectedDrawing = drawings.find((d) => d.id === selected);
  const last = candles.at(-1);

  return (
    <div className="xp-candles" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="xp-candles__bar">
        <div className="segmented" role="group" aria-label="Herramienta de dibujo">
          {TOOLS.map(([t, label, title]) => (
            <button key={t} type="button" className={tool === t ? 'on' : ''} aria-pressed={tool === t} title={title} onClick={() => chooseTool(t)}>
              {label}
            </button>
          ))}
        </div>
        {selectedDrawing && (
          <div className="xp-candles__edit" role="group" aria-label="Dibujo seleccionado">
            {DRAWING_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`xp-candles__swatch${(selectedDrawing.color ?? DEFAULT_DRAWING_COLOR) === c ? ' on' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => recolor(c)}
              />
            ))}
            <button type="button" className="btn btn--small" onClick={removeSelected}>Borrar</button>
          </div>
        )}
        <div className="segmented xp-candles__ranges" role="group" aria-label="Periodo">
          {RANGES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={range === id ? 'on' : ''}
              aria-pressed={range === id}
              onClick={() => { setRange(id); localStorage.setItem(RANGE_KEY, id); showRange(id); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={`xp-candles__chart${tool !== 'cursor' ? ' is-drawing' : ''}`} ref={boxRef} aria-label={`Gráfico de velas de ${item.name ?? symbol}`} role="img">
        {candlesQ.isLoading && <p className="muted small xp-candles__msg">Cargando velas…</p>}
        {!candlesQ.isLoading && !hasData && <p className="muted small xp-candles__msg">No hay velas de este valor en las fuentes de datos.</p>}
      </div>
      <p className="muted small xp-candles__note">
        {hint}
        {drawings.length > 0 && tool === 'cursor' && (
          <>
            {' '}
            <button
              type="button"
              className="link"
              onClick={() => { if (confirm(`¿Borrar los ${drawings.length} dibujos de este valor?`)) { commit([]); setSelected(null); } }}
            >
              Borrar todos
            </button>
          </>
        )}
        {last && <> · Última vela {new Date(`${last.t}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</>}
        {candlesQ.data?.stale && <> · Datos guardados: la fuente no responde</>}
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
