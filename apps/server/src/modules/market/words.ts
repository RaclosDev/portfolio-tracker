/*
 * Las búsquedas de Yahoo y onvista no encuentran nada con nombres largos («wisdomtree swiss gold»), pero sí con dos
 * palabras («swiss gold»). Estas ayudas reparten la búsqueda en parejas y ordenan lo encontrado por coincidencias.
 */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const queryWords = (q: string) => normalize(q).split(' ').filter(Boolean);

/** Parejas de palabras seguidas (como mucho 3) para reintentar una búsqueda larga sin resultados. */
export function wordPairs(q: string): string[] {
  const words = queryWords(q);
  if (words.length < 3) return [];
  return words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`).slice(0, 3);
}

/** Cuántas palabras de la búsqueda aparecen en el nombre. */
export const wordScore = (name: string, words: string[]) => {
  const n = ` ${normalize(name)} `;
  return words.filter((w) => n.includes(w)).length;
};

/** Mismo nombre salvo mayúsculas, acentos y signos. */
export const sameName = (a: string, b: string) => normalize(a) === normalize(b);

/**
 * Junta los resultados de las parejas sin repetir (por clave) y deja los que tienen al menos dos palabras de la
 * búsqueda, los que más tienen primero.
 */
export function rankByWords<T>(q: string, lists: T[][], key: (t: T) => string, name: (t: T) => string): T[] {
  const words = queryWords(q);
  const seen = new Map<string, { item: T; score: number; order: number }>();
  for (const item of lists.flat()) {
    const k = key(item);
    if (!seen.has(k)) seen.set(k, { item, score: wordScore(name(item), words), order: seen.size });
  }
  return [...seen.values()]
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((x) => x.item);
}
