import { num, price } from './format.ts';

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
 * Texto del hover del PER: el actual y, debajo, el que tendría a cada precio de compra. Sin PER o sin niveles
 * devuelve `undefined` y la celda se queda sin hover.
 */
export function perTooltip(
  pe: number | null | undefined,
  current: number | null | undefined,
  levels: number[],
  currency?: string | null,
): string | undefined {
  const lines = levels.flatMap((p, i) => {
    const v = perAt(pe, current, p);
    return v == null ? [] : [`Compra ${i + 1} (${price(p, currency)}): PER ${num(v, 1)}`];
  });
  if (!lines.length) return undefined;
  return [`PER actual: ${num(pe, 1)}`, ...lines].join('\n');
}
