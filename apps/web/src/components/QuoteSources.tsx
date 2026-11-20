import type { Quote } from '@watchlist/shared';

/** Marca de cada fuente: Financial Hub con su F, FT Markets con FT y el resto con su inicial. */
export const sourceMark = (source: string) =>
  /^ft\b/i.test(source) ? 'FT' : (source.trim()[0] ?? '?').toUpperCase();

/** Fuentes de las que han llegado los precios que se ven, de la que más trae a la que menos. */
export function quoteSources(quotes: (Quote | null | undefined)[]) {
  const count = new Map<string, { n: number; fallback: number }>();
  for (const q of quotes) {
    if (!q?.source || q.stale) continue;
    const c = count.get(q.source) ?? { n: 0, fallback: 0 };
    c.n++;
    if (q.fallback) c.fallback++;
    count.set(q.source, c);
  }
  return [...count]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([source, c]) => ({ source, ...c, mark: sourceMark(source) }));
}

/** Junto a «Actualizado…»: de dónde vienen los precios (al pasar el ratón, cuántos de cada fuente). */
export function QuoteSources({ quotes }: { quotes: (Quote | null | undefined)[] }) {
  const sources = quoteSources(quotes);
  if (!sources.length) return null;
  const title = `Precios de: ${sources.map((s) => `${s.source} (${s.n})`).join(', ')}`;
  return (
    <span className="quote-sources" title={title} aria-label={title}>
      {sources.map((s) => (
        <span key={s.source} className="quote-source" aria-hidden="true">
          {s.mark}
        </span>
      ))}
    </span>
  );
}
