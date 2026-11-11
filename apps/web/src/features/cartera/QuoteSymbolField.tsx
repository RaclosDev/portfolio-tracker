import type { Quote, SymbolSearchResult } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { price, shortDate } from '../../lib/format.ts';
import { SymbolPicker } from '../items/SymbolPicker.tsx';

export function QuoteSymbolField({ inputId, value, onChange, onPick, onQuote }: {
  inputId: string;
  value: string;
  onChange: (symbol: string) => void;
  onPick?: (result: SymbolSearchResult) => void;
  onQuote?: (quote: Quote | null) => void;
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
  useEffect(() => { onQuote?.(quote?.price != null ? quote : null); }, [quote, onQuote]);
  return <>
    <label htmlFor={inputId}>Cotización automática (opcional)</label>
    <SymbolPicker inputId={inputId} value={value} onChange={onChange} onPick={(r) => {
      onChange(r.symbol);
      setChecked(r.symbol);
      onPick?.(r);
    }} />
    <div className="field__help" role="status">
      {symbol && checked !== symbol && <button type="button" className="link" onClick={() => setChecked(symbol)}>Comprobar símbolo</button>}
      {symbol && checked === symbol && <>
        {result.isFetching ? 'Comprobando…' : result.isError ? 'No se han podido consultar los precios. Prueba de nuevo más tarde.' : quote?.price != null
          ? `${quote.name ?? symbol} · ${price(quote.price, quote.currency)}${quote.asOf ? ` · VL ${shortDate(quote.asOf)}` : ''}${quote.source ? ` · ${quote.source}` : ''}${quote.isin ? ` · ${quote.isin}` : ''}${quote.stale ? ' (último precio guardado)' : ''}`
          : result.isSuccess ? 'Las fuentes disponibles no devuelven precio. Revisa el código o busca por nombre.' : ''}
      </>}
    </div>
    <span className="field__help">Primero se consulta Yahoo y después las fuentes alternativas con cobertura. En fondos, comprueba el ISIN, la clase y la divisa. Puedes dejarlo vacío para guardar sin cotización.</span>
  </>;
}
