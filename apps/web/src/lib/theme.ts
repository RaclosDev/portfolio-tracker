import { COLOR_DEFS, type Colors } from '@watchlist/shared';

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
