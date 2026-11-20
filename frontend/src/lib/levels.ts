/** Niveles tras la compra: se quita el que se ha comprado (el más cercano al precio de la orden) y los demás suben. */
export function shiftLevels(levels: number[], bought: number) {
  if (!levels.length) return [];
  let at = 0;
  levels.forEach((l, i) => {
    if (Math.abs(l - bought) < Math.abs(levels[at]! - bought)) at = i;
  });
  return levels.filter((_, i) => i !== at);
}
