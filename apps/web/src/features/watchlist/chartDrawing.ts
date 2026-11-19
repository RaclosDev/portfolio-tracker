import { DRAWING_POINTS, INTRADAY_MINUTES, type Candle, type IntradayInterval, type ChartDrawing, type ChartDrawingType, type ChartPoint } from '@watchlist/shared';

/*
 * Geometría de los dibujos del gráfico de velas. Los puntos se guardan como fecha de sesión y precio; en
 * pantalla se pasan a «posición lógica» (índice de la vela). Más allá de la última vela (o antes de la
 * primera) se cuentan días laborables, para que una línea pueda llegar al futuro y no se mueva cuando
 * entran velas nuevas.
 */

const DAY = 86_400_000;
const utc = (t: string) => Date.parse(t.length > 10 ? t : `${t}T00:00:00Z`);
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

/** Intervalo de las velas: intradía, diario, semanal o mensual (las dos últimas se agregan de las diarias). */
export type Step = IntradayInterval | 'D' | 'W' | 'M';
export const isIntraday = (step: Step): step is IntradayInterval => step in INTRADAY_MINUTES;
/** Duración de una vela intradía en milisegundos. */
const barMs = (step: IntradayInterval) => INTRADAY_MINUTES[step] * 60_000;
/** Fecha y hora UTC de una vela intradía (YYYY-MM-DDTHH:MMZ). */
const iso16 = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`;

/** Lunes de la semana de una fecha. */
export function mondayOf(t: string): string {
  const ms = utc(t);
  return iso(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY);
}
const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
function addMonths(from: string, n: number): string {
  const m = Number(from.slice(5, 7)) - 1 + n;
  const y = Number(from.slice(0, 4)) + Math.floor(m / 12);
  return `${y}-${String((((m % 12) + 12) % 12) + 1).padStart(2, '0')}-01`;
}
/** Barras de `from` a `to` fuera de los datos. */
function barsBetween(from: string, to: string, step: Step): number {
  if (isIntraday(step)) return Math.round((utc(to) - utc(from)) / barMs(step));
  if (step === 'W') return Math.round((utc(mondayOf(to)) - utc(mondayOf(from))) / (7 * DAY));
  if (step === 'M') return monthsBetween(from, to);
  return weekdaysBetween(from, to);
}
function shiftBars(from: string, n: number, step: Step): string {
  if (isIntraday(step)) return iso16(utc(from) + n * barMs(step));
  if (step === 'W') return iso(utc(mondayOf(from)) + n * 7 * DAY);
  if (step === 'M') return addMonths(from, n);
  return addWeekdays(from, n);
}

/** Posición lógica de una fecha dentro de las barras `dates` (ordenadas, fecha de inicio de cada una). */
export function toLogical(dates: string[], t: string, step: Step = 'D'): number {
  if (!dates.length) return 0;
  // Un punto dibujado en intradía cae en la vela de su día en los intervalos de días o más.
  if (!isIntraday(step)) t = t.slice(0, 10);
  const last = dates.length - 1;
  if (t > dates[last]!) return last + barsBetween(dates[last]!, t, step);
  if (t < dates[0]!) return barsBetween(dates[0]!, t, step);
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  // En semanas, meses e intradía el punto cae en la barra que lo contiene (la última que empieza antes);
  // una fecha sin hora, en la primera vela de ese día.
  return step === 'D' || dates[lo] === t || (isIntraday(step) && t.length === 10) ? lo : lo - 1;
}

/** Fecha de una posición lógica (redondeada a la barra más cercana). */
export function fromLogical(dates: string[], logical: number, step: Step = 'D'): string {
  const i = Math.round(logical);
  const last = dates.length - 1;
  if (i > last) return shiftBars(dates[last]!, i - last, step);
  if (i < 0) return shiftBars(dates[0]!, i, step);
  return dates[i]!;
}

/**
 * Mete el último precio en directo en las velas diarias o intradía: actualiza la vela en curso o abre la
 * siguiente. Un precio anterior a la última vela no cambia nada; sin hora, solo se toca la vela en curso.
 */
export function mergeLive(candles: Candle[], price: number, at: string | undefined, step: 'D' | IntradayInterval): Candle[] {
  const last = candles.at(-1);
  const ms = at ? Date.parse(at) : last ? Date.parse(last.t.length === 10 ? `${last.t}T12:00:00Z` : last.t) : NaN;
  if (!last || !(price > 0) || Number.isNaN(ms)) return candles;
  const t = step === 'D' ? new Date(ms).toISOString().slice(0, 10) : iso16(Math.floor(ms / barMs(step)) * barMs(step));
  if (t < last.t) return candles;
  if (t > last.t) return [...candles, { t, o: price, h: price, l: price, c: price }];
  if (last.c === price && price <= last.h && price >= last.l) return candles;
  return [...candles.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }];
}

/** Velas semanales o mensuales a partir de las diarias. */
export function aggregate(candles: Candle[], step: Step): Candle[] {
  if (step === 'D') return candles;
  const out: Candle[] = [];
  let key = '';
  for (const c of candles) {
    const k = step === 'W' ? mondayOf(c.t) : c.t.slice(0, 7);
    const bar = out.at(-1);
    if (bar && k === key) {
      bar.h = Math.max(bar.h, c.h);
      bar.l = Math.min(bar.l, c.l);
      bar.c = c.c;
    } else {
      out.push({ ...c });
      key = k;
    }
  }
  return out;
}

/** Media simple de `n` barras (null mientras no hay suficientes). */
export function sma(values: number[], n: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v - (i >= n ? values[i - n]! : 0);
    return i >= n - 1 ? sum / n : null;
  });
}

/** Media exponencial de `n` barras, empezando por la simple de las primeras `n`. */
export function ema(values: number[], n: number): (number | null)[] {
  const k = 2 / (n + 1);
  let prev: number | null = null;
  return sma(values, n).map((s, i) => {
    if (s == null) return null;
    prev = prev == null ? s : values[i]! * k + prev * (1 - k);
    return prev;
  });
}

/** Imán: el precio de la vela (apertura, máximo, mínimo o cierre) más cercano. */
export function snapPrice(c: Candle, p: number): number {
  return [c.o, c.h, c.l, c.c].reduce((best, v) => (Math.abs(v - p) < Math.abs(best - p) ? v : best));
}

export const PERIODS = [
  ['1d', '1D'], ['5d', '5D'], ['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['ytd', 'YTD'],
  ['1y', '1A'], ['3y', '3A'], ['5y', '5A'], ['max', 'Máx'],
] as const;
export type PeriodId = (typeof PERIODS)[number][0];

/** Fecha `months` meses antes de `t`, el mismo día (o el último del mes si no existe). */
function monthsBack(t: string, months: number): string {
  const first = addMonths(t, -months);
  const lastDay = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate();
  return `${first.slice(0, 8)}${String(Math.min(Number(t.slice(8)), lastDay)).padStart(2, '0')}`;
}

/** Índice de la vela diaria de referencia de un periodo (su cierre es la base de la rentabilidad). */
export function periodBase(candles: Candle[], id: PeriodId): number | null {
  const n = candles.length;
  if (!n) return null;
  if (id === 'max') return 0;
  if (id === '1d' || id === '5d') {
    const i = n - 1 - (id === '1d' ? 1 : 5);
    return i >= 0 ? i : null;
  }
  const last = candles[n - 1]!.t;
  // El YTD se mide desde el cierre del año anterior; los demás, desde la última sesión hasta esa fecha.
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 }[id as Exclude<PeriodId, 'max' | '1d' | '5d' | 'ytd'>];
  const limit = id === 'ytd' ? `${last.slice(0, 4)}-01-01` : monthsBack(last, months);
  let i = -1;
  for (let k = 0; k < n; k++) {
    const t = candles[k]!.t;
    if (id === 'ytd' ? t < limit : t <= limit) i = k;
    else break;
  }
  return i >= 0 ? i : null;
}

/** Rentabilidad de un periodo, en tanto por uno (null si no hay datos de tan atrás). */
export function periodReturn(candles: Candle[], id: PeriodId): number | null {
  const i = periodBase(candles, id);
  const base = i == null ? null : candles[i]!.c;
  return base ? candles.at(-1)!.c / base - 1 : null;
}

export const round7 = (p: number) => Number(p.toPrecision(7));

/** Dibujo desplazado `dl` barras y `dp` de precio (las horizontales no se mueven en el tiempo, ni las verticales en precio). */
export function moveDrawing(d: ChartDrawing, dl: number, dp: number, dates: string[], step: Step): ChartDrawing {
  return {
    ...d,
    points: d.points.map((p) => ({
      t: dl === 0 || d.type === 'hline' ? p.t : fromLogical(dates, toLogical(dates, p.t, step) + dl, step),
      p: d.type === 'vline' ? p.p : round7(p.p + dp),
    })),
  };
}

/** Dibujo con el punto `i` llevado a `to` (arrastrando su asa). */
export function dragHandle(d: ChartDrawing, i: number, to: ChartPoint): ChartDrawing {
  // El stop de una posición solo cambia de precio: la caja va de la entrada a la fecha del objetivo.
  const keepT = d.type === 'hline' || ((d.type === 'long' || d.type === 'short') && i === 2);
  return {
    ...d,
    points: d.points.map((p, k) => (k !== i ? p : { t: keepT ? p.t : to.t, p: d.type === 'vline' ? p.p : to.p })),
  };
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
export function channelOffset(dates: string[], [a, b, c]: [ChartPoint, ChartPoint, ChartPoint], step: Step = 'D'): number {
  const la = toLogical(dates, a.t, step);
  const lb = toLogical(dates, b.t, step);
  const lc = toLogical(dates, c.t, step);
  const onBase = lb === la ? a.p : a.p + ((b.p - a.p) * (lc - la)) / (lb - la);
  return c.p - onBase;
}

export const DRAWING_COLORS = ['#2962ff', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#f6c344', '#787b86'] as const;
export const DEFAULT_DRAWING_COLOR = DRAWING_COLORS[0];

/** Niveles del retroceso de Fibonacci (0 en el segundo punto, 1 en el primero). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export type Tool = 'cursor' | 'measure' | ChartDrawingType;
/** Clics que necesita cada herramienta: las posiciones se crean con uno (la entrada) y se ajustan después. */
export const TOOL_CLICKS: Record<ChartDrawingType, number> = { ...DRAWING_POINTS, long: 1, short: 1 };

export const newDrawingId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
