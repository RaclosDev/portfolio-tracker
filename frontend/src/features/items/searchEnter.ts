/**
 * La lista del buscador se corresponde con lo escrito: la búsqueda va con un retraso (300 ms) y, mientras
 * tanto, la lista enseña los resultados del texto anterior. Con Enter en ese intervalo se elegía uno de ellos.
 * Con un producto abierto (sus bolsas) o con los recientes (campo vacío) no hay búsqueda pendiente.
 */
export const resultsMatchTyped = (typed: string, searched: string, opts: { product: boolean; recent: boolean }) =>
  opts.product || opts.recent || typed.trim() === searched;
