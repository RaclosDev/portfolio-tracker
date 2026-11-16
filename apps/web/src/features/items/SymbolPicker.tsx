import type { InstrumentHit, Listing, SymbolSearchResult } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api } from '../../api/client.ts';
import { price } from '../../lib/format.ts';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Props {
  inputId?: string;
  value: string;
  onChange: (symbol: string) => void;
  onPick: (r: SymbolSearchResult) => void;
  autoFocus?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  EQUITY: 'Acción', ETF: 'ETF', FUND: 'Fondo', MUTUALFUND: 'Fondo', INDEX: 'Índice', CURRENCY: 'Divisa', CRYPTOCURRENCY: 'Cripto',
};
/** Yahoo da a veces el tipo legible («Equity», «Fund»); onvista y los demás, en mayúsculas. */
const typeLabel = (t: string | null) => (t ? (TYPE_LABEL[t.toUpperCase()] ?? t) : null);

/** Una fila elegible: un producto (abre sus bolsas), un ticker directo, una bolsa del producto o «volver». */
type Option =
  | { kind: 'product'; key: string; hit: InstrumentHit }
  | { kind: 'ticker'; key: string; result: SymbolSearchResult }
  | { kind: 'listing'; key: string; listing: Listing }
  | { kind: 'back'; key: string };

/**
 * Campo de símbolo en dos pasos, como en los brókers: se busca el producto por nombre, ISIN o WKN y después
 * se elige en qué bolsa seguirlo, cada una con su precio y divisa. Los tickers directos siguen debajo.
 */
export function SymbolPicker({ value, onChange, onPick, autoFocus, inputId = 'symbol' }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [product, setProduct] = useState<InstrumentHit | null>(null);
  const q = useDebounced(value.trim(), 300);
  const listId = useId();
  const searching = open && !product && q.length >= 2;

  const tickers = useQuery({ queryKey: ['search', q], queryFn: () => api.search(q), enabled: searching, staleTime: 5 * 60_000 });
  const products = useQuery({
    queryKey: ['instruments', q],
    queryFn: () => api.instruments(q),
    enabled: searching && q.length >= 3,
    staleTime: 10 * 60_000,
  });
  const listings = useQuery({
    queryKey: ['listings', product?.isin],
    queryFn: () => api.listings(product!.isin),
    enabled: open && !!product,
    staleTime: 60_000,
  });

  const options: Option[] = product
    ? [{ kind: 'back', key: 'back' }, ...(listings.data ?? []).map((listing) => ({ kind: 'listing' as const, key: `l:${listing.symbol}`, listing }))]
    : [
        ...(products.data ?? []).map((hit) => ({ kind: 'product' as const, key: `p:${hit.isin}`, hit })),
        ...(tickers.data ?? []).map((result) => ({ kind: 'ticker' as const, key: `t:${result.symbol}`, result })),
      ];
  const fetching = product ? listings.isFetching : tickers.isFetching || products.isFetching;
  const firstTicker = options.findIndex((o) => o.kind === 'ticker');
  const noResults = searching && !fetching && tickers.isFetched && options.length === 0;
  const showList = open && (options.length > 0 || noResults);
  const noListings = !!product && !listings.isFetching && options.length === 1;

  const choose = (o: Option) => {
    if (o.kind === 'product') return (setProduct(o.hit), setActive(1));
    if (o.kind === 'back') return (setProduct(null), setActive(0));
    if (o.kind === 'ticker') onPick(o.result);
    else onPick({ symbol: o.listing.symbol, name: product!.name, exchange: o.listing.exchange, type: o.listing.type ?? product!.type });
    setProduct(null);
    setOpen(false);
  };

  const heading = (o: Option, i: number) => {
    if (product) return null;
    if (i === 0 && o.kind === 'product') return 'Productos: elige uno para ver dónde cotiza';
    if (i === firstTicker && firstTicker > 0) return 'Tickers';
    return null;
  };

  return (
    <div className="combo">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        data-autofocus={autoFocus || undefined}
        placeholder="Nombre, ticker, ISIN o WKN (p. ej. Inditex, ITX.MC)"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setProduct(null);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => (setOpen(false), setProduct(null)), 150)}
        onKeyDown={(e) => {
          // Escape en las bolsas vuelve a los productos; en la lista de productos, la cierra.
          if (e.key === 'Escape' && product) return (e.stopPropagation(), e.preventDefault(), setProduct(null), setActive(0));
          if (!showList) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, options.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === 'Enter' && options.length) (e.preventDefault(), choose(options[Math.min(active, options.length - 1)]!));
          else if (e.key === 'Escape') (e.stopPropagation(), e.preventDefault(), setOpen(false));
        }}
      />
      {fetching && <span className="combo__spinner" aria-hidden />}
      {showList && (
        <ul className="combo__list" id={listId} role="listbox" aria-label={product ? `Bolsas de ${product.name}` : 'Resultados'}>
          {options.map((o, i) => {
            const title = heading(o, i);
            const row = (
              <li
                key={o.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`combo__row--${o.kind}${i === active ? ' active' : ''}`}
                onMouseDown={(e) => (e.preventDefault(), choose(o))}
                onMouseEnter={() => setActive(i)}
              >
                <OptionContent option={o} product={product} />
              </li>
            );
            return title ? [<li key={`h:${o.key}`} role="presentation" className="combo__group">{title}</li>, row] : row;
          })}
          {noResults && (
            <li role="presentation" className="combo__empty">
              Sin resultados. Prueba con menos palabras, el ISIN o el ticker.
            </li>
          )}
          {noListings &&<li role="presentation" className="combo__empty">No hay ninguna bolsa con precio para este producto.</li>}
        </ul>
      )}
    </div>
  );
}

function OptionContent({ option: o, product }: { option: Option; product: InstrumentHit | null }) {
  switch (o.kind) {
    case 'product':
      return (
        <>
          <span className="ticker">{o.hit.isin}</span>
          <span className="combo__name">{o.hit.name}</span>
          <span className="sub">{typeLabel(o.hit.type)} · ver bolsas ›</span>
        </>
      );
    case 'ticker':
      return (
        <>
          <span className="ticker">{o.result.symbol}</span>
          <span className="combo__name">{o.result.name}</span>
          <span className="sub">{[o.result.exchange, typeLabel(o.result.type)].filter(Boolean).join(' · ')}</span>
        </>
      );
    case 'listing':
      return (
        <>
          <span className="ticker">{o.listing.symbol}</span>
          <span className="combo__name">
            {o.listing.exchange ?? 'Bolsa sin nombre'}
            {o.listing.priceOnly && <span className="sub"> · solo precio, sin gráfico</span>}
          </span>
          <span className="combo__price">{o.listing.price !== null ? price(o.listing.price, o.listing.currency) : 'sin precio'}</span>
        </>
      );
    case 'back':
      return (
        <>
          <span className="ticker">‹ Volver</span>
          <span className="combo__name">{product?.name}</span>
          <span className="sub">{product?.isin}</span>
        </>
      );
  }
}
