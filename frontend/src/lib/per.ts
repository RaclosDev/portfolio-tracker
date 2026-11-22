/**
 * PER que tendría el valor a otro precio, con el mismo beneficio que el PER actual: PER × (precio / precio actual).
 * El precio y la cotización van en la misma divisa (los niveles se apuntan en la del valor), así que el cociente
 * no depende de ella. Sin PER positivo (ETF, fondo, pérdidas) o sin precio actual no hay cálculo.
 */
export function perAt(pe: number | null | undefined, current: number | null | undefined, at: number): number | null {
  if (pe == null || !(pe > 0) || current == null || !(current > 0) || !(at > 0)) return null;
  return (pe * at) / current;
}

/**
 * PER a cada precio de compra (`n` es el número del nivel: Compra 1, Compra 2…). Sin PER o sin niveles
 * devuelve una lista vacía y la celda se queda sin hover.
 */
export function perLevels(
  pe: number | null | undefined,
  current: number | null | undefined,
  levels: number[],
): { n: number; price: number; per: number }[] {
  return levels.flatMap((p, i) => {
    const v = perAt(pe, current, p);
    return v == null ? [] : [{ n: i + 1, price: p, per: v }];
  });
}
