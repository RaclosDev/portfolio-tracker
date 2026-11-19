import type { ChartDrawing, ChartPoint } from '@watchlist/shared';
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { channelOffset, DEFAULT_DRAWING_COLOR, FIB_LEVELS, toLogical, type Step } from './chartDrawing.ts';

export type XY = [number, number];
export type Seg = [number, number, number, number];
/** Geometría en pantalla de un dibujo: trazos y zonas (para pintarlo y para saber si se ha pulsado) y asas. */
export interface Geo {
  lines: Seg[];
  areas: XY[][];
  /** Una por punto guardado, en el mismo orden (null si no cabe en pantalla). */
  handles: (XY | null)[];
}
/** Un dibujo, o el que se está creando (con los puntos que lleva). */
export type Shape = Pick<ChartDrawing, 'type' | 'points'> & Partial<Omit<ChartDrawing, 'type' | 'points'>>;
export interface Measure {
  a: ChartPoint;
  b: ChartPoint;
  done: boolean;
}

const EMPTY: Geo = { lines: [], areas: [], handles: [] };
const FIB_COLORS = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86'];
const DASH: Record<NonNullable<ChartDrawing['style']>, number[]> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };
const LABEL_FONT = '11px system-ui, sans-serif';
export const TEXT_FONT = '600 14px system-ui, sans-serif';
export const DEFAULT_TEXT = 'Texto';

const box = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const edges = (poly: XY[]): Seg[] => poly.map((p, i) => [...p, ...poly[(i + 1) % poly.length]!] as Seg);

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = TEXT_FONT;
  return measureCtx.measureText(text).width;
}

/** Prolonga la recta de `a` a `b` más allá de `b`, hasta el borde del panel. */
function extend(a: XY, b: XY, w: number, h: number): XY {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ks: number[] = [];
  if (dx) ks.push(((dx > 0 ? w : 0) - a[0]) / dx);
  if (dy) ks.push(((dy > 0 ? h : 0) - a[1]) / dy);
  if (!ks.length) return b;
  const k = Math.max(1, Math.min(...ks));
  return [a[0] + dx * k, a[1] + dy * k];
}

const fmtDate = (t: string) =>
  new Date(`${t}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });

function axisView(coord: () => number | null, text: string, back: string): ISeriesPrimitiveAxisView {
  return {
    coordinate: () => coord() ?? -10_000,
    visible: () => coord() != null,
    text: () => text,
    textColor: () => '#ffffff',
    backColor: () => back,
  };
}

interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface MediaTarget {
  useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void;
}

/**
 * Pinta los dibujos en el lienzo del gráfico, con sus etiquetas en los ejes, el dibujo que se está creando y
 * la regla de medir. También calcula su geometría en pantalla, que es lo que usa el gráfico para seleccionar
 * y arrastrar.
 */
export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  drawings: ChartDrawing[] = [];
  selected: string | null = null;
  preview: Shape | null = null;
  measure: Measure | null = null;
  hidden = false;
  dates: string[] = [];
  step: Step = 'D';
  precision = 2;
  colors = { text: '#5b6372', up: '#16a34a', down: '#dc2626' };
  width = 0;
  height = 0;
  private param: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private view: IPrimitivePaneView;
  private priceViews: ISeriesPrimitiveAxisView[] = [];
  private timeViews: ISeriesPrimitiveAxisView[] = [];

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target as unknown as MediaTarget) };
    this.view = { renderer: () => renderer, zOrder: () => 'top' };
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) {
    this.param = param;
    this.refreshAxis();
  }
  detached() { this.param = null; }
  paneViews() { return [this.view]; }
  priceAxisViews() { return this.priceViews; }
  timeAxisViews() { return this.timeViews; }

  /** Tras cambiar los dibujos o los datos: rehace las etiquetas de los ejes y repinta. */
  update() {
    this.refreshAxis();
    this.param?.requestUpdate();
  }

  private refreshAxis() {
    const shown = this.hidden ? [] : this.drawings;
    this.priceViews = shown
      .filter((d) => d.type === 'hline' || d.type === 'hray')
      .map((d) => {
        const p = d.points[0]!.p;
        return axisView(() => this.y(p), p.toFixed(this.precision), d.color ?? DEFAULT_DRAWING_COLOR);
      });
    this.timeViews = shown
      .filter((d) => d.type === 'vline')
      .map((d) => {
        const t = d.points[0]!.t;
        return axisView(() => this.x(t), fmtDate(t), d.color ?? DEFAULT_DRAWING_COLOR);
      });
  }

  x(t: string): number | null {
    return this.param?.chart.timeScale().logicalToCoordinate(toLogical(this.dates, t, this.step) as Logical) ?? null;
  }
  y(p: number): number | null {
    return this.param?.series.priceToCoordinate(p) ?? null;
  }
  xy(point: ChartPoint): XY | null {
    const x = this.x(point.t);
    const y = this.y(point.p);
    return x == null || y == null ? null : [x, y];
  }

  geo(d: Shape): Geo {
    const W = this.width;
    const H = this.height;
    const [p0, p1, p2] = d.points;
    if (!p0) return EMPTY;
    if (d.type === 'hline') {
      const y = this.y(p0.p);
      return y == null ? EMPTY : { lines: [[0, y, W, y]], areas: [], handles: [[W / 2, y]] };
    }
    if (d.type === 'vline') {
      const x = this.x(p0.t);
      return x == null ? EMPTY : { lines: [[x, 0, x, H]], areas: [], handles: [[x, H / 2]] };
    }
    const a = this.xy(p0);
    if (!a) return EMPTY;
    if (d.type === 'hray') return { lines: [[a[0], a[1], Math.max(W, a[0]), a[1]]], areas: [], handles: [a] };
    if (d.type === 'text') {
      const w = textWidth(d.text || DEFAULT_TEXT);
      return { lines: [], areas: [box(a[0] - 4, a[1] - 18, a[0] + w + 4, a[1] + 5)], handles: [a] };
    }
    const b = p1 ? this.xy(p1) : null;
    if (!b) return { lines: [], areas: [], handles: [a] };
    switch (d.type) {
      case 'ray':
        return { lines: [[...a, ...extend(a, b, W, H)]], areas: [], handles: [a, b] };
      case 'extended':
        return { lines: [[...extend(b, a, W, H), ...extend(a, b, W, H)]], areas: [], handles: [a, b] };
      case 'rect': {
        const poly = box(a[0], a[1], b[0], b[1]);
        return { lines: edges(poly), areas: [poly], handles: [a, b] };
      }
      case 'fib': {
        const x0 = Math.min(a[0], b[0]);
        const x1 = Math.max(a[0], b[0]);
        const ys = FIB_LEVELS.map((l) => this.y(p1!.p + (p0.p - p1!.p) * l));
        if (ys.some((y) => y == null)) return EMPTY;
        return { lines: ys.map((y) => [x0, y!, x1, y!] as Seg), areas: [box(x0, a[1], x1, b[1])], handles: [a, b] };
      }
      case 'channel': {
        if (!p2) return { lines: [[...a, ...b]], areas: [], handles: [a, b] };
        const off = channelOffset(this.dates, [p0, p1!, p2], this.step);
        const qa = this.xy({ t: p0.t, p: p0.p + off });
        const qb = this.xy({ t: p1!.t, p: p1!.p + off });
        if (!qa || !qb) return { lines: [[...a, ...b]], areas: [], handles: [a, b, this.xy(p2)] };
        return { lines: [[...a, ...b], [...qa, ...qb]], areas: [[a, b, qb, qa]], handles: [a, b, this.xy(p2)] };
      }
      case 'long':
      case 'short': {
        const ys = p2 ? this.y(p2.p) : null;
        if (ys == null) return EMPTY;
        return {
          lines: [[a[0], a[1], b[0], a[1]]],
          areas: [box(a[0], b[1], b[0], ys)],
          handles: [a, b, [a[0], ys]],
        };
      }
      default: // tendencia y flecha
        return { lines: [[...a, ...b]], areas: [], handles: [a, b] };
    }
  }

  private draw(target: MediaTarget) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      this.width = mediaSize.width;
      this.height = mediaSize.height;
      if (!this.hidden) for (const d of this.drawings) this.paint(ctx, d, d.id === this.selected);
      if (this.preview) this.paint(ctx, this.preview, true);
      if (this.measure) this.paintMeasure(ctx, this.measure);
    });
  }

  private paint(ctx: CanvasRenderingContext2D, d: Shape, selected: boolean) {
    const g = this.geo(d);
    if (!g.handles.length) return;
    const color = d.color ?? DEFAULT_DRAWING_COLOR;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = d.width ?? 2;
    ctx.setLineDash(DASH[d.style ?? 'solid']);
    const stroke = (segs: Seg[]) => {
      for (const [x1, y1, x2, y2] of segs) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };
    const fill = (poly: XY[] | undefined, alpha: number, style = color) => {
      if (!poly) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = style;
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    switch (d.type) {
      case 'rect':
        fill(g.areas[0], 0.15);
        stroke(g.lines);
        break;
      case 'channel': {
        const [s, t] = g.lines;
        fill(g.areas[0], 0.1);
        if (s && t) {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          stroke([[(s[0] + t[0]) / 2, (s[1] + t[1]) / 2, (s[2] + t[2]) / 2, (s[3] + t[3]) / 2]]);
          ctx.restore();
        }
        stroke(g.lines);
        break;
      }
      case 'fib': {
        const [p0, p1] = d.points as [ChartPoint, ChartPoint];
        ctx.font = LABEL_FONT;
        g.lines.forEach((seg, i) => {
          const next = g.lines[i + 1];
          if (next) fill(box(seg[0], seg[1], seg[2], next[1]), 0.08, FIB_COLORS[i]);
          ctx.strokeStyle = FIB_COLORS[i]!;
          ctx.fillStyle = FIB_COLORS[i]!;
          stroke([seg]);
          const level = FIB_LEVELS[i]!;
          ctx.fillText(`${level} (${(p1.p + (p0.p - p1.p) * level).toFixed(this.precision)})`, seg[0] + 4, seg[1] - 3);
        });
        ctx.strokeStyle = color;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const [a, b] = g.handles;
        if (a && b) stroke([[...a, ...b]]);
        ctx.restore();
        break;
      }
      case 'long':
      case 'short':
        this.paintPosition(ctx, d, g);
        break;
      case 'text': {
        const a = g.handles[0]!;
        ctx.font = TEXT_FONT;
        ctx.fillText(d.text || DEFAULT_TEXT, a[0], a[1]);
        if (selected) {
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          stroke(edges(g.areas[0]!));
        }
        break;
      }
      case 'arrow': {
        stroke(g.lines);
        const [a, b] = g.handles;
        if (a && b) {
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const len = 8 + 3 * (d.width ?? 2);
          ctx.setLineDash([]);
          stroke([0.45, -0.45].map((k) => [b[0], b[1], b[0] - len * Math.cos(ang + k), b[1] - len * Math.sin(ang + k)] as Seg));
        }
        break;
      }
      default:
        stroke(g.lines);
    }
    if (selected) {
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = '#ffffff';
      for (const h of d.type === 'text' ? [] : g.handles) {
        if (!h) continue;
        ctx.beginPath();
        ctx.arc(h[0], h[1], 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Posición larga o corta: zona de beneficio (de la entrada al objetivo) y de pérdida (de la entrada al stop). */
  private paintPosition(ctx: CanvasRenderingContext2D, d: Shape, g: Geo) {
    const [e, t, s] = d.points as [ChartPoint, ChartPoint, ChartPoint];
    const [a, b, c] = g.handles as [XY, XY, XY];
    const left = Math.min(a[0], b[0]);
    const w = Math.abs(b[0] - a[0]);
    const ye = a[1];
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = this.colors.up;
    ctx.fillRect(left, Math.min(ye, b[1]), w, Math.abs(b[1] - ye));
    ctx.fillStyle = this.colors.down;
    ctx.fillRect(left, Math.min(ye, c[1]), w, Math.abs(c[1] - ye));
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.colors.text;
    ctx.beginPath();
    ctx.moveTo(left, ye);
    ctx.lineTo(left + w, ye);
    ctx.stroke();
    const pct = (p: number) => `${p >= e.p ? '+' : ''}${((p / e.p - 1) * 100).toFixed(2)} %`;
    const risk = Math.abs(s.p - e.p);
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.colors.text;
    const cx = left + w / 2;
    // Cada etiqueta va dentro de su zona, junto al borde de fuera.
    ctx.fillText(`Objetivo ${t.p.toFixed(this.precision)} (${pct(t.p)})`, cx, b[1] < ye ? b[1] + 13 : b[1] - 5);
    ctx.fillText(`Stop ${s.p.toFixed(this.precision)} (${pct(s.p)})`, cx, c[1] > ye ? c[1] - 5 : c[1] + 13);
    ctx.fillText(`Entrada ${e.p.toFixed(this.precision)} · R/B ${risk ? (Math.abs(t.p - e.p) / risk).toFixed(2) : '—'}`, cx, ye - 4);
  }

  private paintMeasure(ctx: CanvasRenderingContext2D, m: Measure) {
    const a = this.xy(m.a);
    const b = this.xy(m.b);
    if (!a || !b) return;
    const color = m.b.p >= m.a.p ? this.colors.up : this.colors.down;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    ctx.beginPath();
    ctx.moveTo(mx, a[1]);
    ctx.lineTo(mx, b[1]);
    ctx.moveTo(a[0], my);
    ctx.lineTo(b[0], my);
    ctx.stroke();
    const diff = m.b.p - m.a.p;
    const bars = Math.round(toLogical(this.dates, m.b.t, this.step) - toLogical(this.dates, m.a.t, this.step));
    const unit = this.step === 'W' ? 'semanas' : this.step === 'M' ? 'meses' : 'sesiones';
    const label = `${diff >= 0 ? '+' : ''}${diff.toFixed(this.precision)} (${((diff / m.a.p) * 100).toFixed(2)} %) · ${bars} ${unit}`;
    ctx.font = LABEL_FONT;
    const w = ctx.measureText(label).width + 12;
    const y = Math.max(a[1], b[1]) + 6;
    ctx.fillStyle = color;
    ctx.fillRect(mx - w / 2, y, w, 18);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, mx, y + 13);
    ctx.restore();
  }
}
