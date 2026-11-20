/**
 * Redondea a céntimos (la mitad, hacia fuera del cero). Pasa por 15 cifras significativas para que el error de
 * coma flotante no cambie el resultado: 1332,555 da 1332,56 aunque 1332,555 · 100 sea 133255,49999999999.
 */
export function cents(x: number): number {
  if (!Number.isFinite(x)) return x;
  const v = Math.round(Math.abs(Number((x * 100).toPrecision(15)))) / 100;
  return x < 0 && v !== 0 ? -v : v;
}

/**
 * Reparte `total` (en euros con céntimos) según `weights` sin perder ni un céntimo: cada parte queda a menos de un
 * céntimo de su valor exacto y la suma de las partes es cents(total · Σ pesos).
 */
export function splitCents(total: number, weights: readonly number[]): number[] {
  let acc = 0;
  let prev = 0;
  return weights.map((w) => {
    acc += w;
    const upTo = cents(total * acc);
    const part = cents(upTo - prev);
    prev = upTo;
    return part;
  });
}
