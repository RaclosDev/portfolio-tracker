import type { SymbolSearchResult } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api } from '../../api/client.ts';

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

/** Campo de símbolo con búsqueda por nombre, ticker o ISIN (combobox accesible). */
export function SymbolPicker({ value, onChange, onPick, autoFocus, inputId = 'symbol' }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(value.trim(), 300);
  const listId = useId();

  const { data = [], isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: open && q.length >= 2,
    staleTime: 5 * 60_000,
  });

  const pick = (r: SymbolSearchResult) => {
    onPick(r);
    setOpen(false);
  };

  return (
    <div className="combo">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open && data.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        data-autofocus={autoFocus || undefined}
        placeholder="Nombre, ticker o ISIN (p. ej. Inditex, ITX.MC)"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !data.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, data.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === 'Enter') (e.preventDefault(), pick(data[active]!));
          else if (e.key === 'Escape') (e.stopPropagation(), e.preventDefault(), setOpen(false));
        }}
      />
      {isFetching && <span className="combo__spinner" aria-hidden />}
      {open && data.length > 0 && (
        <ul className="combo__list" id={listId} role="listbox">
          {data.map((r, i) => (
            <li
              key={r.symbol}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => (e.preventDefault(), pick(r))}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ticker">{r.symbol}</span>
              <span className="combo__name">{r.name}</span>
              <span className="sub">
                {[r.exchange, r.type].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
