import type { ChartDrawing, ChartPoint } from '@watchlist/shared';

/*
 * Geometría de los dibujos del gráfico de velas. Los puntos se guardan como fecha de sesión y precio; en
 * pantalla se pasan a «posición lógica» (índice de la vela). Más allá de la última vela (o antes de la
 * primera) se cuentan días laborables, para que una línea pueda llegar al futuro y no se mueva cuando
 * entran velas nuevas.
 */

const DAY = 86_400_000;
const utc = (t: string) => Date.parse(`${t}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isWeekday = (ms: number) => { const d = new Date(ms).getUTCDay(); return d !== 0 && d !== 6; };

/** Días laborables de `from` (excluido) a `to` (incluido); negativo si `to` es anterior. */
export function weekdaysBetween(from: string, to: string): number {
  const a = utc(from);
  const b = utc(to);
  const sign = b >= a ? 1 : -1;
  let n = 0;
  for (let ms = a + sign * DAY; sign > 0 ? ms <= b : ms >= b; ms += sign * DAY) if (isWeekday(ms)) n += sign;
  return n;
}

/** Fecha `n` días laborables después (o antes, si es negativo) de `from`. */
export function addWeekdays(from: string, n: number): string {
  let ms = utc(from);
  const step = n >= 0 ? 1 : -1;
  for (let left = Math.abs(n); left > 0;) {
    ms += step * DAY;
    if (isWeekday(ms)) left--;
  }
  return iso(ms);
}

/** Posición lógica de una fecha dentro de las sesiones `dates` (ordenadas). */
export function toLogical(dates: string[], t: string): number {
  if (!dates.length) return 0;
  const last = dates.length - 1;
  if (t > dates[last]!) return last + weekdaysBetween(dates[last]!, t);
  if (t < dates[0]!) return weekdaysBetween(dates[0]!, t);
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Fecha de una posición lógica (redondeada a la sesión más cercana). */
export function fromLogical(dates: string[], logical: number): string {
  const i = Math.round(logical);
  const last = dates.length - 1;
  if (i > last) return addWeekdays(dates[last]!, i - last);
  if (i < 0) return addWeekdays(dates[0]!, i);
  return dates[i]!;
}

/** Distancia de un punto al segmento AB (en píxeles). */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

/** Si un punto cae dentro de un polígono (regla par-impar). */
export function insidePolygon(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Paralela de un canal: los dos puntos de la línea base desplazados lo que marca el tercero. */
export function channelOffset(dates: string[], [a, b, c]: [ChartPoint, ChartPoint, ChartPoint]): number {
  const la = toLogical(dates, a.t);
  const lb = toLogical(dates, b.t);
  const lc = toLogical(dates, c.t);
  const onBase = lb === la ? a.p : a.p + ((b.p - a.p) * (lc - la)) / (lb - la);
  return c.p - onBase;
}

export const DRAWING_COLORS = ['#2962ff', '#e53935', '#43a047', '#fb8c00', '#8e24aa'] as const;
export const DEFAULT_DRAWING_COLOR = DRAWING_COLORS[0];

export type Tool = 'cursor' | ChartDrawing['type'];
/** Clics que necesita cada herramienta. */
export const TOOL_POINTS: Record<Exclude<Tool, 'cursor'>, number> = { hline: 1, trend: 2, channel: 3 };

export const newDrawingId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
