import type { PortfolioRow } from '@watchlist/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { usePositionMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { money, num, parseDecimal, price } from '../../lib/format.ts';
import { positionName } from './PortfolioPage.tsx';

interface Props {
  row: PortfolioRow;
  type: 'buy' | 'sell';
  base: string;
  onClose: () => void;
}

/** Registrar otra compra (recalcula el precio medio) o una venta (resta acciones) de una posición. */
export function TradeDialog({ row, type, base, onClose }: Props) {
  const { position: p, quote } = row;
  const [shares, setShares] = useState('');
  const [tradePrice, setTradePrice] = useState(quote?.price != null ? String(quote.price).replace('.', ',') : '');
  const [costBase, setCostBase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { trade } = usePositionMutations();
  const cur = quote?.currency ?? '';

  const n = parseDecimal(shares);
  const px = parseDecimal(tradePrice);
  const newAvg = type === 'buy' && n && px ? (p.shares * p.avgPrice + n * px) / (p.shares + n) : null;
  const left = type === 'sell' && n ? p.shares - n : null;
  const name = positionName(row);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!n || n <= 0) return setError('Indica cuántas acciones.');
    if (type === 'sell' && n > p.shares + 1e-9) return setError(`Solo tienes ${num(p.shares, 3)} acciones.`);
    if (type === 'buy' && (!px || px <= 0)) return setError('Indica el precio de la compra.');
    if (type === 'sell' && left != null && left < 1e-9 && !confirm(`Vendes todas: ${name} saldrá de la cartera. ¿Seguir?`)) return;
    try {
      await trade.mutateAsync({
        id: p.id,
        t: type === 'buy' ? { type, shares: n, price: px!, costBase: parseDecimal(costBase) } : { type, shares: n },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar');
    }
  };

  return (
    <Dialog
      title={type === 'buy' ? `Otra compra de ${name}` : `Venta de ${name}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="trade-form" className="btn btn--primary" disabled={trade.isPending}>
            {trade.isPending ? 'Guardando…' : type === 'buy' ? 'Registrar compra' : 'Registrar venta'}
          </button>
        </>
      }
    >
      <form id="trade-form" className="form" onSubmit={submit} noValidate>
        <p className="muted">
          Ahora tienes {num(p.shares, Number.isInteger(p.shares) ? 0 : 3)} acciones a un precio medio de {price(p.avgPrice)} {cur}.
        </p>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="tr-shares">Acciones {type === 'buy' ? 'compradas' : 'vendidas'}</label>
            <input id="tr-shares" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} data-autofocus />
            {type === 'sell' && (
              <button type="button" className="link field__help" onClick={() => setShares(String(p.shares).replace('.', ','))}>
                Vender todas
              </button>
            )}
          </div>
          {type === 'buy' && (
            <div className="field">
              <label htmlFor="tr-price">Precio ({cur})</label>
              <input id="tr-price" inputMode="decimal" value={tradePrice} onChange={(e) => setTradePrice(e.target.value)} />
            </div>
          )}
          {type === 'buy' && p.costBase != null && (
            <div className="field">
              <label htmlFor="tr-cost">Pagado en {base}</label>
              <input id="tr-cost" inputMode="decimal" value={costBase} onChange={(e) => setCostBase(e.target.value)} />
              <span className="field__help">Para seguir sumando lo pagado; si lo dejas vacío se usará el cambio de hoy.</span>
            </div>
          )}
        </div>
        <p className="field__help" aria-live="polite">
          {newAvg != null && (
            <>
              Quedarán {num(p.shares + n!, 3).replace(/,?0+$/, '')} acciones a un precio medio de <strong>{price(newAvg)}</strong>{' '}
              {cur} ({money((n! * px!) / (row.metrics.fxRate ?? 1), base)} más invertidos).
            </>
          )}
          {left != null && left >= 1e-9 && <>Te quedarán {num(left, 3).replace(/,?0+$/, '')} acciones. El precio medio no cambia.</>}
          {left != null && left < 1e-9 && left > -1e-9 && <>Vendes toda la posición.</>}
        </p>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
