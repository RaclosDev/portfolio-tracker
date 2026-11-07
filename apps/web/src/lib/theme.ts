import { COLOR_DEFS, type Colors, type Settings } from '@watchlist/shared';

/**
 * Aplica los colores configurables como variables CSS (--c-<clave>).
 * styles.css deriva de ellas los fondos suaves y el color de texto legible
 * para el tema claro y el oscuro.
 */
export function applyColors(colors: Partial<Colors> | undefined) {
  const root = document.documentElement.style;
  for (const { key, default: fallback } of COLOR_DEFS) {
    root.setProperty(`--c-${key}`, colors?.[key] ?? fallback);
  }
}

/** Tema, densidad y tamaño de letra (atributos data-* en <html> que usa styles.css). */
export function applyAppearance(s: Pick<Settings, 'theme' | 'density' | 'fontSize'>) {
  const el = document.documentElement;
  if (s.theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = s.theme;
  el.dataset.density = s.density;
  el.dataset.font = s.fontSize;
}
