import type { Quote } from '@watchlist/shared';

/** Marca de cada fuente: Financial Hub con su pizarra, Yahoo con su Y y el resto con su inicial. */
export const sourceMark = (source: string) =>
  /financial hub/i.test(source) ? '🪧' : /yahoo/i.test(source) ? 'Y' : (source.trim()[0] ?? '?').toUpperCase();

/** Fuentes de las que han llegado los precios que se ven, de la que más trae a la que menos. */
export function quoteSources(quotes: (Quote | null | undefined)[]) {
  const count = new Map<string, number>();
  for (const q of quotes) if (q?.source && !q.stale) count.set(q.source, (count.get(q.source) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, n, mark: sourceMark(source) }));
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
