import type { Candle } from '@/shared';

/** Un valor por vela; `null` donde aún no hay barras suficientes. */
export type Series = (number | null)[];

export type IndKind =
  | 'sma' | 'ema' | 'wma' | 'hma' | 'dema'
  | 'bb' | 'donchian' | 'ichimoku' | 'psar'
  | 'rsi' | 'macd' | 'stoch' | 'cci' | 'willr' | 'roc'
  | 'atr';
export type IndGroup = 'medias' | 'bandas' | 'osciladores' | 'volatilidad';

export const IND_GROUPS: [IndGroup, string][] = [
  ['medias', 'Medias móviles'],
  ['bandas', 'Bandas y canales'],
  ['osciladores', 'Osciladores'],
  ['volatilidad', 'Volatilidad'],
];

export interface ParamDef {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step?: number;
}

export interface LineDef {
  key: string;
  label: string;
  style?: 'line' | 'dashed' | 'dots' | 'histogram';
  /** Color fijo; sin él, el del indicador. */
  color?: string;
  width?: number;
}

export interface IndicatorDef {
  kind: IndKind;
  name: string;
  short: string;
  group: IndGroup;
  /** Encima del precio o en un panel propio debajo. */
  pane: 'price' | 'sub';
  params: ParamDef[];
  lines: LineDef[];
  /** Líneas de referencia del panel (p. ej. 30 y 70 en el RSI). */
  levels?: number[];
  /** Escala fija del panel. */
  range?: [number, number];
  /** Relleno entre dos líneas; con colores fijos si cambia según cuál va arriba (nube de Ichimoku). */
  fill?: { a: string; b: string; up?: string; down?: string };
  /** Decimales en su panel; sin él, los del precio. */
  precision?: number;
  compute: (bars: Candle[], p: Record<string, number>) => Record<string, Series>;
}

export interface Indicator {
  id: string;
  kind: IndKind;
  params: Record<string, number>;
  color: string;
  hidden?: boolean;
}

// --- Cálculos base ---------------------------------------------------------------------------------

const nulls = (n: number): Series => new Array<number | null>(n).fill(null);

/** Media simple de las últimas `n` cifras seguidas sin huecos. */
export function smaS(v: Series, n: number): Series {
  const out = nulls(v.length);
  let sum = 0;
  let run = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x == null) { sum = 0; run = 0; continue; }
    sum += x;
    run++;
    if (run > n) sum -= v[i - n]!;
    if (run >= n) out[i] = sum / n;
  }
  return out;
}

/** Media exponencial (por defecto 2/(n+1); Wilder usa 1/n), sembrada con la media simple. */
export function emaS(v: Series, n: number, alpha = 2 / (n + 1)): Series {
  const out = nulls(v.length);
  let prev: number | null = null;
  let sum = 0;
  let run = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x == null) {
      if (prev == null) { sum = 0; run = 0; }
      continue;
    }
    if (prev == null) {
      sum += x;
      if (++run === n) out[i] = prev = sum / n;
    } else {
      out[i] = prev = prev + alpha * (x - prev);
    }
  }
  return out;
}

const wilder = (v: Series, n: number) => emaS(v, n, 1 / n);

/** Media ponderada: la última vela pesa n, la anterior n-1… */
export function wmaS(v: Series, n: number): Series {
  const out = nulls(v.length);
  const div = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const x = v[i - k];
      if (x == null) { ok = false; break; }
      s += x * (n - k);
    }
    if (ok) out[i] = s / div;
  }
  return out;
}

const zip = (a: Series, b: Series, f: (x: number, y: number) => number): Series =>
  a.map((x, i) => (x == null || b[i] == null ? null : f(x, b[i]!)));

/** Hull: WMA(2·WMA(n/2) − WMA(n), √n). Sigue al precio con muy poco retraso. */
export function hmaS(v: Series, n: number): Series {
  const half = wmaS(v, Math.max(1, Math.floor(n / 2)));
  const full = wmaS(v, n);
  return wmaS(zip(half, full, (h, f) => 2 * h - f), Math.max(1, Math.floor(Math.sqrt(n))));
}

/** Doble exponencial: 2·EMA − EMA(EMA). */
export function demaS(v: Series, n: number): Series {
  const e = emaS(v, n);
  return zip(e, emaS(e, n), (a, b) => 2 * a - b);
}

function rolling(v: number[], n: number, f: (win: number[]) => number): Series {
  const out = nulls(v.length);
  for (let i = n - 1; i < v.length; i++) out[i] = f(v.slice(i - n + 1, i + 1));
  return out;
}
const highest = (v: number[], n: number) => rolling(v, n, (w) => Math.max(...w));
const lowest = (v: number[], n: number) => rolling(v, n, (w) => Math.min(...w));
const shift = (v: Series, by: number): Series => v.map((_, i) => v[i - by] ?? null);

// --- Indicadores -----------------------------------------------------------------------------------

const closes = (b: Candle[]) => b.map((c) => c.c);

export function bollinger(c: number[], n: number, k: number) {
  const mid = smaS(c, n);
  const sd = c.map((_, i) => {
    const m = mid[i];
    if (m == null) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (c[j]! - m) ** 2;
    return Math.sqrt(s / n);
  });
  return { mid, upper: zip(mid, sd, (m, d) => m + k * d), lower: zip(mid, sd, (m, d) => m - k * d) };
}

export function donchian(b: Candle[], n: number) {
  const upper = highest(b.map((x) => x.h), n);
  const lower = lowest(b.map((x) => x.l), n);
  return { upper, lower, mid: zip(upper, lower, (u, l) => (u + l) / 2) };
}

/** Ichimoku con las líneas desplazadas dentro de las velas que hay (no se proyecta al futuro). */
export function ichimoku(b: Candle[], t: number, k: number, s: number) {
  const h = b.map((x) => x.h);
  const l = b.map((x) => x.l);
  const mid = (n: number) => zip(highest(h, n), lowest(l, n), (a, z) => (a + z) / 2);
  const tenkan = mid(t);
  const kijun = mid(k);
  return {
    tenkan,
    kijun,
    spanA: shift(zip(tenkan, kijun, (a, z) => (a + z) / 2), k),
    spanB: shift(mid(s), k),
    chikou: shift(closes(b), -k),
  };
}

/** Parabólico SAR de Wilder. */
export function psar(b: Candle[], step: number, max: number): Series {
  const out = nulls(b.length);
  if (b.length < 2) return out;
  let up = b[1]!.c >= b[0]!.c;
  let sar = up ? b[0]!.l : b[0]!.h;
  let ep = up ? b[0]!.h : b[0]!.l;
  let af = step;
  for (let i = 1; i < b.length; i++) {
    const bar = b[i]!;
    const prev = b[i - 1]!;
    const prev2 = b[i - 2] ?? prev;
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, prev.l, prev2.l);
      if (bar.l < sar) {
        up = false;
        sar = ep;
        ep = bar.l;
        af = step;
      } else if (bar.h > ep) {
        ep = bar.h;
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, prev.h, prev2.h);
      if (bar.h > sar) {
        up = true;
        sar = ep;
        ep = bar.h;
        af = step;
      } else if (bar.l < ep) {
        ep = bar.l;
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

export function rsi(c: number[], n: number): Series {
  const gain: Series = c.map((x, i) => (i === 0 ? null : Math.max(x - c[i - 1]!, 0)));
  const loss: Series = c.map((x, i) => (i === 0 ? null : Math.max(c[i - 1]! - x, 0)));
  return zip(wilder(gain, n), wilder(loss, n), (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l)));
}

export function macd(c: number[], fast: number, slow: number, signal: number) {
  const line = zip(emaS(c, fast), emaS(c, slow), (a, b) => a - b);
  const sig = emaS(line, signal);
  return { macd: line, signal: sig, hist: zip(line, sig, (a, b) => a - b) };
}

export function stochastic(b: Candle[], n: number, smooth: number, d: number) {
  const hh = highest(b.map((x) => x.h), n);
  const ll = lowest(b.map((x) => x.l), n);
  const raw = b.map((x, i) => (hh[i] == null ? null : hh[i]! === ll[i]! ? 50 : (100 * (x.c - ll[i]!)) / (hh[i]! - ll[i]!)));
  const k = smaS(raw, smooth);
  return { k, d: smaS(k, d) };
}

export function atr(b: Candle[], n: number): Series {
  const tr = b.map((x, i) => {
    const pc = b[i - 1]?.c;
    return pc == null ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - pc), Math.abs(x.l - pc));
  });
  return wilder(tr, n);
}

export function cci(b: Candle[], n: number): Series {
  const tp = b.map((x) => (x.h + x.l + x.c) / 3);
  const m = smaS(tp, n);
  return tp.map((x, i) => {
    const avg = m[i];
    if (avg == null) return null;
    let md = 0;
    for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j]! - avg);
    md /= n;
    return md === 0 ? 0 : (x - avg) / (0.015 * md);
  });
}

export function williamsR(b: Candle[], n: number): Series {
  const hh = highest(b.map((x) => x.h), n);
  const ll = lowest(b.map((x) => x.l), n);
  return b.map((x, i) => (hh[i] == null ? null : hh[i]! === ll[i]! ? -50 : (-100 * (hh[i]! - x.c)) / (hh[i]! - ll[i]!)));
}

export function roc(c: number[], n: number): Series {
  return c.map((x, i) => (i < n || !c[i - n] ? null : (100 * (x - c[i - n]!)) / c[i - n]!));
}

// --- Catálogo --------------------------------------------------------------------------------------

const P = (key: string, label: string, def: number, min = 1, max = 500, step = 1): ParamDef => ({ key, label, def, min, max, step });
const period = (def: number) => P('n', 'Periodo', def);
const avg = (kind: IndKind, short: string, name: string, f: (v: Series, n: number) => Series, def: number): IndicatorDef => ({
  kind, short, name, group: 'medias', pane: 'price', params: [period(def)], lines: [{ key: 'v', label: short, width: 2 }],
  compute: (b, p) => ({ v: f(closes(b), p.n!) }),
});
const SIGNAL = '#ff6d00';

export const INDICATOR_DEFS: Record<IndKind, IndicatorDef> = {
  sma: avg('sma', 'SMA', 'Media simple', smaS, 20),
  ema: avg('ema', 'EMA', 'Media exponencial', emaS, 20),
  wma: avg('wma', 'WMA', 'Media ponderada', wmaS, 20),
  hma: avg('hma', 'HMA', 'Media de Hull', hmaS, 21),
  dema: avg('dema', 'DEMA', 'Media exponencial doble', demaS, 20),
  bb: {
    kind: 'bb', short: 'BB', name: 'Bandas de Bollinger', group: 'bandas', pane: 'price',
    params: [period(20), P('k', 'Desviaciones', 2, 0.5, 5, 0.1)],
    lines: [{ key: 'upper', label: 'Sup.' }, { key: 'mid', label: 'Media', style: 'dashed' }, { key: 'lower', label: 'Inf.' }],
    fill: { a: 'upper', b: 'lower' },
    compute: (b, p) => bollinger(closes(b), p.n!, p.k!),
  },
  donchian: {
    kind: 'donchian', short: 'DC', name: 'Canal de Donchian', group: 'bandas', pane: 'price',
    params: [period(20)],
    lines: [{ key: 'upper', label: 'Sup.' }, { key: 'mid', label: 'Media', style: 'dashed' }, { key: 'lower', label: 'Inf.' }],
    fill: { a: 'upper', b: 'lower' },
    compute: (b, p) => donchian(b, p.n!),
  },
  ichimoku: {
    kind: 'ichimoku', short: 'Ichimoku', name: 'Nube de Ichimoku', group: 'bandas', pane: 'price',
    params: [P('t', 'Tenkan', 9), P('k', 'Kijun', 26), P('s', 'Senkou B', 52)],
    lines: [
      { key: 'tenkan', label: 'Tenkan' },
      { key: 'kijun', label: 'Kijun', color: '#b71c1c' },
      { key: 'spanA', label: 'Span A', color: '#43a047' },
      { key: 'spanB', label: 'Span B', color: '#e53935' },
      { key: 'chikou', label: 'Chikou', color: '#9c27b0', style: 'dashed' },
    ],
    fill: { a: 'spanA', b: 'spanB', up: 'rgba(67, 160, 71, 0.14)', down: 'rgba(229, 57, 53, 0.14)' },
    compute: (b, p) => ichimoku(b, p.t!, p.k!, p.s!),
  },
  psar: {
    kind: 'psar', short: 'SAR', name: 'Parabólico SAR', group: 'bandas', pane: 'price',
    params: [P('step', 'Paso', 0.02, 0.001, 0.5, 0.001), P('max', 'Máximo', 0.2, 0.01, 1, 0.01)],
    lines: [{ key: 'v', label: 'SAR', style: 'dots' }],
    compute: (b, p) => ({ v: psar(b, p.step!, p.max!) }),
  },
  rsi: {
    kind: 'rsi', short: 'RSI', name: 'Índice de fuerza relativa', group: 'osciladores', pane: 'sub',
    params: [period(14)], lines: [{ key: 'v', label: 'RSI', width: 2 }], levels: [30, 70], range: [0, 100], precision: 2,
    compute: (b, p) => ({ v: rsi(closes(b), p.n!) }),
  },
  macd: {
    kind: 'macd', short: 'MACD', name: 'MACD', group: 'osciladores', pane: 'sub',
    params: [P('fast', 'Rápida', 12), P('slow', 'Lenta', 26), P('signal', 'Señal', 9)],
    lines: [{ key: 'hist', label: 'Hist.', style: 'histogram' }, { key: 'macd', label: 'MACD', width: 2 }, { key: 'signal', label: 'Señal', color: SIGNAL }],
    levels: [0],
    compute: (b, p) => macd(closes(b), p.fast!, p.slow!, p.signal!),
  },
  stoch: {
    kind: 'stoch', short: 'Estoc.', name: 'Estocástico', group: 'osciladores', pane: 'sub',
    params: [period(14), P('smooth', 'Suavizado %K', 3), P('d', '%D', 3)],
    lines: [{ key: 'k', label: '%K', width: 2 }, { key: 'd', label: '%D', color: SIGNAL }], levels: [20, 80], range: [0, 100], precision: 2,
    compute: (b, p) => stochastic(b, p.n!, p.smooth!, p.d!),
  },
  cci: {
    kind: 'cci', short: 'CCI', name: 'Índice del canal de materias primas', group: 'osciladores', pane: 'sub',
    params: [period(20)], lines: [{ key: 'v', label: 'CCI', width: 2 }], levels: [-100, 100], precision: 1,
    compute: (b, p) => ({ v: cci(b, p.n!) }),
  },
  willr: {
    kind: 'willr', short: '%R', name: 'Williams %R', group: 'osciladores', pane: 'sub',
    params: [period(14)], lines: [{ key: 'v', label: '%R', width: 2 }], levels: [-80, -20], range: [-100, 0], precision: 2,
    compute: (b, p) => ({ v: williamsR(b, p.n!) }),
  },
  roc: {
    kind: 'roc', short: 'ROC', name: 'Tasa de cambio', group: 'osciladores', pane: 'sub',
    params: [period(12)], lines: [{ key: 'v', label: 'ROC', width: 2 }], levels: [0], precision: 2,
    compute: (b, p) => ({ v: roc(closes(b), p.n!) }),
  },
  atr: {
    kind: 'atr', short: 'ATR', name: 'Rango verdadero medio', group: 'volatilidad', pane: 'sub',
    params: [period(14)], lines: [{ key: 'v', label: 'ATR', width: 2 }],
    compute: (b, p) => ({ v: atr(b, p.n!) }),
  },
};

export const IND_COLORS = ['#f6a609', '#2962ff', '#e040fb', '#00bcd4', '#43a047', '#ef5350', '#8d6e63'];

export const defaultParams = (kind: IndKind) =>
  Object.fromEntries(INDICATOR_DEFS[kind].params.map((p) => [p.key, p.def]));

/**
 * Indicador guardado en el navegador, validado. Acepta el formato antiguo de las medias
 * (`{ kind: 'sma', period: 20 }`) y completa o recorta los parámetros fuera de rango.
 */
export function normalizeIndicator(v: unknown): Indicator | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const def = typeof o.kind === 'string' ? INDICATOR_DEFS[o.kind as IndKind] : undefined;
  if (!def || typeof o.id !== 'string' || typeof o.color !== 'string') return null;
  const raw = (o.params && typeof o.params === 'object' ? o.params : { n: o.period }) as Record<string, unknown>;
  const params = Object.fromEntries(
    def.params.map((p) => {
      const x = Number(raw[p.key]);
      return [p.key, Number.isFinite(x) ? Math.min(p.max, Math.max(p.min, x)) : p.def];
    }),
  );
  return { id: o.id, kind: def.kind, params, color: o.color, ...(o.hidden === true ? { hidden: true } : {}) };
}

export const indicatorLabel = (ind: Indicator) => {
  const def = INDICATOR_DEFS[ind.kind];
  return `${def.short} ${def.params.map((p) => ind.params[p.key]!.toLocaleString('es-ES')).join(' ')}`;
};

export const TEMPLATES: { id: string; label: string; title: string; items: { kind: IndKind; params?: Record<string, number>; color?: string }[] }[] = [
  { id: 'trend', label: 'Tendencia', title: 'EMA 50 y EMA 200', items: [{ kind: 'ema', params: { n: 50 }, color: '#2962ff' }, { kind: 'ema', params: { n: 200 }, color: '#e040fb' }] },
  { id: 'momentum', label: 'Momento', title: 'RSI 14 y MACD 12 26 9', items: [{ kind: 'rsi', color: '#7e57c2' }, { kind: 'macd', color: '#2962ff' }] },
  { id: 'volatility', label: 'Volatilidad', title: 'Bandas de Bollinger 20 2 y ATR 14', items: [{ kind: 'bb', color: '#00897b' }, { kind: 'atr', color: '#ef5350' }] },
];
