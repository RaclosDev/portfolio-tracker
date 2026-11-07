import { MAX_BUY_LEVELS, roundUpShares, type ItemInput, type Settings, type WatchlistRow } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/client.ts';
import { useDeleteItem, useSaveItem } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { MINOR_CURRENCY, money, num, parseDecimal, pct, price } from '../../lib/format.ts';
import { SymbolPicker } from './SymbolPicker.tsx';

interface Props {
  listId: number;
  row: WatchlistRow | null; // null = nuevo
  settings: Settings;
  fx: Record<string, number>;
  onClose: () => void;
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

/**
 * Cuando el número escrito lleva punto o coma, muestra cómo se ha entendido ("1.234" puede
 * ser mil doscientos o uno coma dos). Así se ve antes de guardar.
 */
function understood(raw: string, n: number | null) {
  if (n == null || !/[.,]/.test(raw)) return '';
  return `= ${n.toLocaleString('es-ES', { maximumFractionDigits: 6 })}`;
}

const joinHelp = (...parts: string[]) => parts.filter(Boolean).join(' · ') || ' ';

export function ItemDialog({ listId, row, settings, fx, onClose }: Props) {
  const item = row?.item;
  const [symbol, setSymbol] = useState(item?.symbol ?? '');
  const [checkedSymbol, setCheckedSymbol] = useState(item?.symbol ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [levels, setLevels] = useState<string[]>(
    Array.from({ length: MAX_BUY_LEVELS }, (_, i) => str(item?.buyPrices[i])),
  );
  const [brokerTarget, setBrokerTarget] = useState(str(item?.brokerTarget));
  const [brokerName, setBrokerName] = useState(item?.brokerName ?? 'Renta 4');
  const [invest, setInvest] = useState(str(item?.investAmount));
  const [shares, setShares] = useState(str(item?.sharesOverride));
  const [orderActive, setOrderActive] = useState(item?.orderActive ?? false);
  const [orderPrice, setOrderPrice] = useState(str(item?.orderPrice));
  const [orderUntil, setOrderUntil] = useState(item?.orderUntil ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useSaveItem();
  const del = useDeleteItem();

  const quoteQ = useQuery({
    queryKey: ['quote', checkedSymbol],
    queryFn: () => api.quote(checkedSymbol),
    enabled: checkedSymbol.length > 0,
    retry: false,
    staleTime: 60_000,
  });
  const quote = quoteQ.data;
  const current = quote?.price ?? null;
  const currency = quote?.currency ?? null;
  // Si la divisa no está aún en la lista (p. ej. el primer valor en libras), se pide su tipo de cambio.
  const needsFx = !!currency && currency !== settings.baseCurrency && fx[currency] == null;
  const fxQ = useQuery({
    queryKey: ['fx', currency],
    queryFn: () => api.fx([currency!]),
    enabled: needsFx,
    staleTime: 5 * 60_000,
  });
  const fxRate = !currency
    ? undefined
    : currency === settings.baseCurrency
      ? 1
      : (fx[currency] ?? fxQ.data?.[currency]);

  // Vista previa del cálculo de acciones, igual que en la tabla.
  const investN = parseDecimal(invest) ?? settings.defaultInvest;
  const entry = (orderActive ? parseDecimal(orderPrice) : null) ?? parseDecimal(levels[0] ?? '');
  const sharesCalc = entry && fxRate ? (investN * fxRate) / entry : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const buyPrices = levels.map(parseDecimal).filter((v): v is number => v != null && v > 0);
    const data: ItemInput = {
      listId,
      symbol: symbol.trim(),
      name: name.trim() || null,
      buyPrices,
      brokerTarget: parseDecimal(brokerTarget),
      brokerName: brokerTarget.trim() ? brokerName.trim() || null : null,
      investAmount: parseDecimal(invest),
      sharesOverride: shares.trim() ? Math.round(parseDecimal(shares) ?? 0) || null : null,
      orderActive,
      orderPrice: orderActive ? (parseDecimal(orderPrice) ?? buyPrices[0] ?? null) : null,
      orderUntil: orderActive && orderUntil ? orderUntil : null,
      notes: notes.trim() || null,
    };
    if (!data.symbol) return setError('Indica el símbolo.');
    try {
      await save.mutateAsync({ id: item?.id, data });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.issues?.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message
          : 'No se pudo guardar',
      );
    }
  };

  const remove = async () => {
    if (!item || !confirm(`¿Quitar ${item.name ?? item.symbol} de la lista?`)) return;
    await del.mutateAsync(item.id);
    onClose();
  };

  return (
    <Dialog
      title={item ? `Editar ${item.name ?? item.symbol}` : 'Añadir valor'}
      onClose={onClose}
      wide
      footer={
        <>
          {item && (
            <button type="button" className="btn btn--danger-ghost" onClick={remove} disabled={del.isPending}>
              Quitar de la lista
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="item-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="item-form" className="form" onSubmit={submit} noValidate>
        <fieldset className="form__section">
          <legend>Valor</legend>
          <div className="field field--wide">
            <label htmlFor="symbol">Símbolo (Yahoo Finance)</label>
            <SymbolPicker
              value={symbol}
              autoFocus={!item}
              onChange={setSymbol}
              onPick={(r) => {
                setSymbol(r.symbol);
                setCheckedSymbol(r.symbol);
                if (!name) setName(r.name);
              }}
            />
            <div className="field__help" aria-live="polite">
              {quoteQ.isFetching && 'Comprobando…'}
              {quoteQ.isError && <span className="error-text">No se encuentra este símbolo.</span>}
              {quote && (
                <>
                  {quote.name} · <strong>{price(quote.price)} {quote.currency}</strong>
                  {quote.exchange && ` · ${quote.exchange}`}
                </>
              )}
              {!quoteQ.isFetching && !quote && !quoteQ.isError && symbol && symbol !== checkedSymbol && (
                <button type="button" className="link" onClick={() => setCheckedSymbol(symbol.trim().toUpperCase())}>
                  Comprobar símbolo
                </button>
              )}
            </div>
          </div>
          <div className="field field--wide">
            <label htmlFor="name">Nombre (opcional)</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Se toma del mercado si lo dejas vacío" />
          </div>
        </fieldset>

        <fieldset className="form__section">
          <legend>
            Precios de compra {currency && <span className="muted">({currency})</span>}
            {currency && MINOR_CURRENCY[currency] && (
              <span className="muted small"> · {MINOR_CURRENCY[currency]}, introduce los precios en peniques</span>
            )}
          </legend>
          <div className="grid-3">
            {levels.map((v, i) => {
              const n = parseDecimal(v);
              return (
                <div className="field" key={i}>
                  <label htmlFor={`lvl${i}`}>Compra {i + 1}</label>
                  <input
                    id={`lvl${i}`}
                    inputMode="decimal"
                    value={v}
                    onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <span className="field__help">{joinHelp(understood(v, n), n && current ? `${pct((n - current) / current)} vs actual` : '')}</span>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="form__section">
          <legend>Precio objetivo</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="bt">Objetivo bróker</label>
              <input id="bt" inputMode="decimal" value={brokerTarget} onChange={(e) => setBrokerTarget(e.target.value)} />
              <span className="field__help">
                {joinHelp(understood(brokerTarget, parseDecimal(brokerTarget)), parseDecimal(brokerTarget) && current ? `${pct((parseDecimal(brokerTarget)! - current) / current)} potencial` : '')}
              </span>
            </div>
            <div className="field">
              <label htmlFor="bn">Bróker</label>
              <input id="bn" value={brokerName} onChange={(e) => setBrokerName(e.target.value)} />
            </div>
            <div className="field field--readonly">
              <span className="label">Consenso analistas</span>
              <span className="field__value">
                {row?.targets?.mean != null
                  ? `${price(row.targets.mean)} (${row.targets.analysts ?? '?'} analistas)`
                  : 'Se obtiene automáticamente'}
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset className="form__section">
          <legend>Tamaño de la compra</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="inv">Importe a invertir ({settings.baseCurrency})</label>
              <input id="inv" inputMode="decimal" value={invest} placeholder={num(settings.defaultInvest)} onChange={(e) => setInvest(e.target.value)} />
              <span className="field__help">{joinHelp(understood(invest, parseDecimal(invest)))}</span>
            </div>
            <div className="field">
              <label htmlFor="sh">Acciones a comprar</label>
              <input
                id="sh"
                inputMode="numeric"
                value={shares}
                placeholder={sharesCalc != null ? num(roundUpShares(sharesCalc)) : ''}
                onChange={(e) => setShares(e.target.value)}
              />
              <span className="field__help">
                {sharesCalc != null ? `Calculadas: ${num(sharesCalc, 2)} · vacío = automático` : ' '}
              </span>
            </div>
            <div className="field field--readonly">
              <span className="label">Importe resultante</span>
              <span className="field__value">
                {entry && fxRate
                  ? money(((parseDecimal(shares) ?? (sharesCalc != null ? roundUpShares(sharesCalc) : 0)) * entry) / fxRate, settings.baseCurrency)
                  : '–'}
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset className={`form__section${orderActive ? ' form__section--order' : ''}`}>
          <legend>Orden en el banco</legend>
          <label className="check">
            <input type="checkbox" checked={orderActive} onChange={(e) => setOrderActive(e.target.checked)} />
            Tengo una orden de compra puesta
          </label>
          {orderActive && (
            <div className="grid-3">
              <div className="field">
                <label htmlFor="op">Precio límite</label>
                <input id="op" inputMode="decimal" value={orderPrice} placeholder={levels[0]} onChange={(e) => setOrderPrice(e.target.value)} />
                <span className="field__help">{joinHelp(understood(orderPrice, parseDecimal(orderPrice)))}</span>
              </div>
              <div className="field">
                <label htmlFor="ou">Válida hasta</label>
                <input id="ou" type="date" value={orderUntil} onChange={(e) => setOrderUntil(e.target.value)} />
              </div>
            </div>
          )}
        </fieldset>

        <div className="field field--wide">
          <label htmlFor="notes">Notas</label>
          <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
