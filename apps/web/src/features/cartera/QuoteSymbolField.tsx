import type { SymbolSearchResult } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { price } from '../../lib/format.ts';
import { SymbolPicker } from '../items/SymbolPicker.tsx';

export function QuoteSymbolField({ inputId, value, onChange, onPick }: {
  inputId: string;
  value: string;
  onChange: (symbol: string) => void;
  onPick?: (result: SymbolSearchResult) => void;
}) {
  const symbol = value.trim().toUpperCase();
  const [checked, setChecked] = useState(symbol);
  const result = useQuery({
    queryKey: ['portfolio-symbol', checked],
    queryFn: () => api.quotes([checked]),
    enabled: !!checked && checked === symbol,
    staleTime: 60_000,
    retry: false,
  });
  const quote = checked === symbol ? result.data?.find((q) => q.symbol === symbol) : undefined;
  return <>
    <label htmlFor={inputId}>Cotización en Yahoo (opcional)</label>
    <SymbolPicker inputId={inputId} value={value} onChange={onChange} onPick={(r) => {
      onChange(r.symbol);
      setChecked(r.symbol);
      onPick?.(r);
    }} />
    <div className="field__help" role="status">
      {symbol && checked !== symbol && <button type="button" className="link" onClick={() => setChecked(symbol)}>Comprobar símbolo</button>}
      {symbol && checked === symbol && <>
        {result.isFetching ? 'Comprobando…' : result.isError ? 'No se ha podido consultar Yahoo. Prueba de nuevo más tarde.' : quote?.price != null
          ? `${quote.name ?? symbol} · ${price(quote.price, quote.currency)}${quote.stale ? ' (último precio guardado)' : ''}`
          : result.isSuccess ? 'Yahoo no devuelve precio para este símbolo. Revisa el código o busca por nombre.' : ''}
      </>}
    </div>
    <span className="field__help">En fondos, elige la misma clase y divisa. Si no está en Yahoo, deja este campo vacío; las operaciones se guardan sin precio actualizado.</span>
  </>;
}
