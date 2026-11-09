import { COLOR_DEFS, type Colors, type Settings } from '@watchlist/shared';

/*
 * Colores configurables. Cada estado tiene un color base (Ajustes → Aspecto); de él se derivan
 * un fondo suave y un color de texto. El texto se calcula aquí, midiendo el contraste real con
 * el fondo en el tema activo, para que se lea siempre (WCAG AA, 4,5:1) aunque el color elegido
 * sea muy claro o muy oscuro. styles.css tiene valores de reserva por si esto no se ejecuta.
 */

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB | null => {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c); // #fff (el minificador acorta así)
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToCss = ([r, g, b]: RGB) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
const mix = (a: RGB, b: RGB, pctB: number): RGB => a.map((v, i) => v + (b[i]! - v) * (pctB / 100)) as RGB;

function luminance([r, g, b]: RGB) {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
export function contrast(a: RGB, b: RGB) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Texto: el color base, acercado al color de texto del tema lo justo para llegar a 4,5:1 (con margen) en todos los fondos. */
function readableOn(base: RGB, backgrounds: RGB[], text: RGB) {
  for (let p = 0; p <= 100; p += 4) {
    const fg = mix(base, text, p);
    if (backgrounds.every((bg) => contrast(fg, bg) >= 4.6)) return fg;
  }
  return text;
}

/** Estados con etiqueta (texto sobre fondo suave) y el % de color en su fondo. */
const BADGES: { key: keyof Colors; fg: string; bg: string; bgPct: number }[] = [
  { key: 'reached', fg: '--reached-fg', bg: '--reached-bg', bgPct: 20 },
  { key: 'veryNear', fg: '--veryNear-fg', bg: '--veryNear-bg', bgPct: 20 },
  { key: 'near', fg: '--near-fg', bg: '--near-bg', bgPct: 22 },
  { key: 'far', fg: '--far-fg', bg: '--far-bg', bgPct: 16 },
  { key: 'veryFar', fg: '--veryFar-fg', bg: '--veryFar-bg', bgPct: 14 },
  { key: 'expired', fg: '--expired-fg', bg: '--expired-bg', bgPct: 22 },
  { key: 'fx', fg: '--fx-fg', bg: '--fx-bg', bgPct: 18 },
  { key: 'equity', fg: '--equity-fg', bg: '--equity-bg', bgPct: 16 },
  { key: 'etf', fg: '--etf-fg', bg: '--etf-bg', bgPct: 16 },
  { key: 'base', fg: '--base-fg', bg: '--base-bg', bgPct: 16 },
  { key: 'muted', fg: '--muted-fg', bg: '--muted-bg', bgPct: 14 },
  { key: 'order', fg: '--order-fg', bg: '--order-badge-bg', bgPct: 26 },
];

let current: Partial<Colors> | undefined;

function derive() {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const surface = hexToRgb(css.getPropertyValue('--surface'));
  const text = hexToRgb(css.getPropertyValue('--text'));
  if (!surface || !text) return; // sin tema resuelto: se quedan los valores de reserva de styles.css
  const color = (key: keyof Colors) => hexToRgb(current?.[key] ?? COLOR_DEFS.find((c) => c.key === key)!.default)!;

  for (const b of BADGES) {
    const bg = mix(surface, color(b.key), b.bgPct);
    root.style.setProperty(b.bg, rgbToCss(bg));
    // El texto también se usa sobre la superficie (p. ej. en el gráfico): se exige en ambos fondos.
    root.style.setProperty(b.fg, rgbToCss(readableOn(color(b.key), [bg, surface], text)));
  }
  root.style.setProperty('--order-bg', rgbToCss(mix(surface, color('order'), 12)));
  for (const k of ['up', 'down'] as const) root.style.setProperty(`--${k}`, rgbToCss(readableOn(color(k), [surface], text)));
}

/** Aplica los colores elegidos (variables --c-*) y recalcula los textos legibles. */
export function applyColors(colors: Partial<Colors> | undefined) {
  current = colors;
  const root = document.documentElement.style;
  for (const { key, default: fallback } of COLOR_DEFS) root.setProperty(`--c-${key}`, colors?.[key] ?? fallback);
  derive();
}

/** Tema, densidad y tamaño de letra (atributos data-* en <html> que usa styles.css). */
export function applyAppearance(s: Pick<Settings, 'theme' | 'density' | 'fontSize'>) {
  const el = document.documentElement;
  if (s.theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = s.theme;
  el.dataset.density = s.density;
  el.dataset.font = s.fontSize;
  derive(); // el contraste depende del tema
}

// Si el tema es "como Windows" y Windows cambia entre claro y oscuro, se recalcula.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', derive);
