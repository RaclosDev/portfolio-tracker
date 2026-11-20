import { MAX_BUY_LEVELS, displayTicker, type Item, type TouchedOrder } from '@/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { parseDecimal, price, timeAgo } from '../lib/format.ts';
import { shiftLevels } from '../lib/levels.ts';
import { Dialog } from './Dialog.tsx';
import { toastError } from './feedback.tsx';
import { Icon } from './Icon.tsx';

export const touchedKey = ['touchedOrders'] as const;

/** Órdenes tocadas pendientes de revisar (se repasan cada minuto; el servidor las detecta en cada vuelta). */
export const useTouchedOrders = (enabled = true) =>
  useQuery({ queryKey: touchedKey, queryFn: api.touchedOrders, refetchInterval: 60_000, enabled });

/** Fecha local AAAA-MM-DD del momento en que se tocó la orden. */
const localDate = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');

/**
 * Aviso en la cabecera: «Orden completada» cuando el precio ha llegado a una orden activa. Al pulsarlo se ven
 * las órdenes; cada una se revisa (abre la compra en la cartera con sus datos) o se descarta si no se ejecutó.
 */
export function TouchedOrdersButton({ onReview }: { onReview: (o: TouchedOrder) => void }) {
  const qc = useQueryClient();
  const { data = [] } = useTouchedOrders();
  const [open, setOpen] = useState(false);
  if (!data.length) return null;

  const dismiss = async (o: TouchedOrder) => {
    try {
      await api.dismissTouchedOrder(o.itemId);
      await qc.invalidateQueries({ queryKey: touchedKey });
      if (data.length === 1) setOpen(false);
    } catch (e) {
      toastError('No se pudo descartar la orden.')(e);
    }
  };

  const label = data.length === 1 ? 'Orden completada' : `${data.length} órdenes completadas`;
  return (
    <>
      <button type="button" className="order-done" title="Revisa la compra y apúntala en la cartera" onClick={() => setOpen(true)}>
        <Icon name="check" size={16} />
        <span className="order-done__label">{label}</span>
        <span className="order-done__count" aria-hidden="true">{data.length}</span>
      </button>
      {open && (
        <Dialog title={label} onClose={() => setOpen(false)}>
          <p className="muted">El precio ha llegado a {data.length === 1 ? 'esta orden' : 'estas órdenes'}. Revisa la compra con los datos reales del banco y apúntala en la cartera.</p>
          <ul className="touched-list">
            {data.map((o) => (
              <li key={`${o.itemId}-${o.orderPrice}`}>
                <div className="touched-list__info">
                  <strong>{o.name ?? displayTicker(o)}</strong>
                  <span className="muted">
                    {displayTicker(o)} · orden a {price(o.orderPrice, o.currency)} · cotizaba a {price(o.price, o.currency)} · {timeAgo(o.at)}
                  </span>
                </div>
                <div className="touched-list__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => void dismiss(o)}>No se ejecutó</button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                      setOpen(false);
                      onReview(o);
                    }}
                  >
                    Revisar y apuntar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}

/** Datos con los que se abre la compra en la cartera a partir de una orden tocada. */
export function touchedDraft(o: TouchedOrder) {
  return {
    type: 'buy' as const,
    ticker: displayTicker(o),
    symbol: o.symbol,
    isin: o.isin,
    name: o.name,
    currency: o.currency,
    shares: o.shares ?? undefined,
    price: o.orderPrice,
    date: localDate(o.at),
    broker: o.broker,
    note: `Tu orden a ${price(o.orderPrice, o.currency)} se tocó el ${new Date(o.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}. Revisa los datos con los del banco (acciones, precio, comisión, cambio…) antes de guardar.`,
  };
}

/** Tras apuntar la compra: arrastrar los precios de compra (el 2 pasa a 1, el 3 a 2) o poner otros. */
export function LevelsAfterBuy({ item, bought, currency, onClose }: { item: Item; bought: number; currency?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const shifted = shiftLevels(item.buyPrices, bought);
  const fmt = (v: number) => String(v).replace('.', ',');
  const [values, setValues] = useState(() => Array.from({ length: MAX_BUY_LEVELS }, (_, i) => (shifted[i] != null ? fmt(shifted[i]!) : '')));
  const [saving, setSaving] = useState(false);
  const parsed = values.map((v) => (v.trim() ? parseDecimal(v) : null));
  const invalid = parsed.some((p, i) => values[i]!.trim() && (p == null || p <= 0));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateItem(item.id, { buyPrices: parsed.filter((p): p is number => p != null) });
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      toastError('No se pudieron guardar los precios de compra.')(e);
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="Precios de compra"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Dejar como estaban</button>
          <button type="button" className="btn btn--primary" disabled={invalid || saving} onClick={() => void save()}>
            Guardar niveles
          </button>
        </>
      }
    >
      <p className="muted">
        Compra de {item.name ?? displayTicker(item)} apuntada. Antes tenías{' '}
        {item.buyPrices.length ? item.buyPrices.map((l) => price(l, currency)).join(' · ') : 'ningún nivel'}.
        {shifted.length ? ' Te proponemos quitar el que se ha comprado y subir los demás; puedes cambiar cualquiera.' : ' Puedes poner niveles nuevos.'}
      </p>
      <div className="form">
        {values.map((v, i) => (
          <div key={i} className="field">
            <label htmlFor={`lvl-${i}`}>Compra {i + 1}{currency ? ` (${currency})` : ''}</label>
            <input
              id={`lvl-${i}`}
              inputMode="decimal"
              value={v}
              data-autofocus={i === 0 ? '' : undefined}
              aria-invalid={!!v.trim() && (parsed[i] == null || parsed[i]! <= 0)}
              onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
