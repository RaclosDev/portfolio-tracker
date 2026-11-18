import {
  isinInSymbol,
  isIncome,
  KNOWN_BROKERS,
  localToday,
  OPERATION_LABELS,
  OPERATION_TYPES,
  operationInputSchema,
  type Instrument,
  type Operation,
  type OperationInput,
  type OperationType,
  type Quote,
  type SymbolSearchResult,
} from '@watchlist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/client.ts';
import { useOperationMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { toast } from '../../components/feedback.tsx';
import { money, parseDecimal } from '../../lib/format.ts';
import { QuoteSymbolField } from './QuoteSymbolField.tsx';
import { proposeTicker } from './proposeTicker.ts';
import { tradeTotal } from './tradeTotal.ts';

/** Datos con los que abrir el alta (p. ej. «Lo he comprado» desde la lista de vigilancia). */
export interface OperationDraft {
  type?: OperationType;
  ticker?: string;
  symbol?: string;
  isin?: string | null;
  name?: string | null;
  currency?: string;
  shares?: number;
  price?: number;
  date?: string;
  broker?: string | null;
}

interface Props {
  operation: Operation | null;
  draft?: OperationDraft;
  instruments: Instrument[];
  brokers: string[];
  onClose: () => void;
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Alta y edición de una operación del registro (compra, venta, dividendo…). */
export function OperationDialog({ operation: op, draft, instruments, brokers, onClose }: Props) {
  const { save, remove } = useOperationMutations();
  // Un borrador con símbolo («Lo he comprado») es del valor que ya se tiene con ese símbolo, se llame como se llame su ticker.
  const initial =
    (!op && draft?.symbol ? instruments.find((i) => i.symbol?.toUpperCase() === draft.symbol!.toUpperCase()) : undefined) ??
    instruments.find((i) => i.ticker === (op?.ticker ?? draft?.ticker ?? '').trim().toUpperCase());
  const [type, setType] = useState<OperationType>(op?.type ?? draft?.type ?? 'buy');
  const [date, setDate] = useState(op?.date ?? draft?.date ?? localToday());

  const dateRef = useRef({ date, type });
  dateRef.current = { date, type };
  const [ticker, setTicker] = useState(op?.ticker ?? (draft?.symbol ? initial?.ticker : undefined) ?? draft?.ticker ?? '');
  const [symbol, setSymbol] = useState<string | null>(initial?.symbol ?? draft?.symbol ?? null);
  const [name, setName] = useState(initial?.name ?? draft?.name ?? null);
  const [currency, setCurrency] = useState(initial?.currency ?? draft?.currency ?? 'EUR');
  const [verifiedSymbol, setVerifiedSymbol] = useState<string | null>(null);
  const [quoteIsin, setQuoteIsin] = useState<string | null>(null);
  const [withoutQuote, setWithoutQuote] = useState(false);
  const [shares, setShares] = useState(str(op?.shares ?? draft?.shares));
  const [priceRaw, setPrice] = useState(str(op?.price ?? draft?.price));
  const [fees, setFees] = useState(str(op?.fees || null));
  const [fx, setFxRaw] = useState(str(op?.fxRate));
  const [fxTouched, setFxTouched] = useState(!!op);
  const setFx = (v: string) => { setFxRaw(v); setFxTouched(v !== ''); };
  const [amount, setAmount] = useState(str(op?.amountEur));
  const [amountTouched, setAmountTouched] = useState(!!op);
  const [whEs, setWhEs] = useState(str(op?.withholdingEs));
  const [whForeign, setWhForeign] = useState(str(op?.withholdingForeign));
  const [ratio, setRatio] = useState(str(op?.splitRatio));
  const [broker, setBroker] = useState(op?.broker ?? draft?.broker ?? '');
  const [notes, setNotes] = useState(op?.notes ?? '');
  const [dayOrder, setDayOrder] = useState(op?.dayOrder != null ? String(op.dayOrder) : '');
  const [transferRef, setTransferRef] = useState(op?.transferRef ?? '');
  const [review, setReview] = useState(op?.needsReview ?? false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [error]);
  // Cambios sin guardar: solo lo que escribe el usuario (el símbolo y la divisa también los rellena la búsqueda de cotización).
  const formState = JSON.stringify([type, date, ticker, shares, priceRaw, fees, fx, amount, whEs, whForeign, ratio, broker, notes, dayOrder, transferRef, review]);
  const [initialForm] = useState(formState);
  const dirty = formState !== initialForm;
  const qc = useQueryClient();

  const t = ticker.trim().toUpperCase();
  const quoteSymbol = symbol ?? (/^0P[A-Z0-9]{8}(?:\.[A-Z]{1,3})?$|^[A-Z]{2}[A-Z0-9]{9}\d$|^BORSA:2FADB\d+$|^[A-Z]+:[A-Z]{2}[A-Z0-9]{9}\d$/.test(t) ? t : '');
  const known = instruments.find((i) => i.ticker === t);
  const foreign = currency !== 'EUR';
  const income = isIncome(type);
  const transfer = type === 'transfer_out' || type === 'transfer_in';
  const trade = type === 'buy' || type === 'sell' || transfer;

  // Importe en euros propuesto a partir de acciones, precio, comisiones y cambio (se puede corregir).
  const n = (s: string) => parseDecimal(s);
  // Cambio: el que escribas; si no, el implícito en el total en € del extracto; si no, el de mercado de ese día.
  const marketFx = useQuery({
    queryKey: ['fx', 'EUR', currency, date],
    queryFn: () => api.fx([currency], date, 'EUR'),
    enabled: foreign && trade && /^[A-Z]{3}$/.test(currency) && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 60 * 60_000,
  }).data?.[currency];
  const impliedFx = (() => {
    const sh = n(shares), pr = n(priceRaw), total = n(amount);
    if (!foreign || !amountTouched || !sh || !pr || !total || total <= 0) return null;
    const gross = sh * pr + (type === 'buy' || type === 'transfer_in' ? 1 : -1) * (n(fees) ?? 0);
    return gross > 0 ? Math.round((gross / total) * 10000) / 10000 : null;
  })();
  const fxAuto = fxTouched ? null : (impliedFx ?? (marketFx ? Math.round(marketFx * 10000) / 10000 : null));
  const fxShown = fxTouched ? fx : fxAuto != null ? str(fxAuto) : '';
  const fxN = foreign ? n(fxShown) : 1;
  // Un cambio muy distinto del de mercado suele ser un error (el inverso, o un 1 que se quedó puesto).
  const fxOff = foreign && fxN && marketFx ? (Math.abs(fxN / marketFx - 1) > 0.05 ? Math.abs(fxN / marketFx - 1) : null) : null;
  const suggested = trade ? tradeTotal(type === 'buy' || type === 'transfer_in' ? 'buy' : 'sell', n(shares), n(priceRaw), n(fees) ?? 0, currency, fxN) : null;
  const amountShown = amountTouched ? amount : suggested != null ? str(suggested) : amount;
  // ISIN para la ficha del valor, solo si aún no tiene uno.
  const isin = initial?.isin ? null : (draft?.isin ?? quoteIsin ?? isinInSymbol(quoteSymbol));
  const quoteVerified = !!quoteSymbol && verifiedSymbol === quoteSymbol.trim().toUpperCase();
  const acceptQuote = useCallback((quote: Quote | null) => {
    setVerifiedSymbol(quote?.symbol ?? null);
    setQuoteIsin(quote?.isin ?? null);
    if (quote) {
      setName((current) => current || quote.name);
      if (quote.currency) setCurrency(quote.currency);
      // Precio de hoy como punto de partida en una compra o venta de hoy; en fechas pasadas no vale.
      if (quote.price && dateRef.current.date === localToday() && ['buy', 'sell'].includes(dateRef.current.type)) setPrice((current) => current || str(quote.price));
    }
  }, []);

  // Al elegir el valor en el buscador: si ya lo tienes, es ese; si es nuevo, se propone su ticker (salvo que hayas escrito uno).
  const pickValue = (r: SymbolSearchResult) => {
    const s = r.symbol.trim().toUpperCase();
    const owned = instruments.find((i) => i.symbol?.toUpperCase() === s || (!!r.isin && i.isin === r.isin && !i.symbol));
    if (owned) {
      setTicker(owned.ticker);
      setName(owned.name ?? r.name);
      if (owned.currency) setCurrency(owned.currency);
      return;
    }
    setName(r.name);
    if (!t || known) setTicker(proposeTicker(s, instruments));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!t) return setError('Busca el valor por nombre, ISIN o ticker, o escribe su ticker.');
    if (!/^[A-Za-z]{3}$/.test(currency)) return setError('Indica la divisa del precio (EUR, USD, GBP…).');
    if (!quoteVerified && !withoutQuote) return setError('Comprueba la cotización o marca que quieres guardar sin precio actualizado.');
    if (trade && foreign && (fxN == null || fxN <= 0)) return setError(`Indica el cambio de la operación: cuántos ${currency} equivalían a 1 €.`);
    if (dayOrder.trim() && !/^[1-9]\d?$/.test(dayOrder.trim())) return setError('El orden en el día debe ser un número del 1 al 99.');
    const data: OperationInput = {
      date,
      ticker: t,
      type,
      shares: trade || type === 'scrip' ? n(shares) : null,
      price: trade ? n(priceRaw) : null,
      fees: n(fees) ?? 0,
      fxRate: trade ? (fxN ?? 1) : (op?.fxRate ?? 1),
      amountEur: type === 'scrip' || type === 'split' ? 0 : (n(amountShown) ?? 0),
      withholdingEs: income ? n(whEs) : null,
      withholdingForeign: income ? n(whForeign) : null,
      splitRatio: type === 'split' ? n(ratio) : null,
      broker: broker.trim() || null,
      notes: notes.trim() || null,
      needsReview: review,
      source: op?.source ?? 'manual',
      sourceRef: op?.sourceRef ?? null,
      lotRef: type === 'scrip' ? (op?.lotRef ?? null) : null,
      dayOrder: dayOrder.trim() ? Number(dayOrder.trim()) : null,
      transferRef: transfer ? transferRef.trim() || null : null,
    };
    try {
      await save.mutateAsync({
        id: op?.id,
        data,
        instrument: { symbol: quoteSymbol.trim() || null, name, currency, ...(isin ? { isin } : {}) },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.issues?.length ? err.issues.map((i) => i.message).join(' · ') : (err as Error).message);
    }
  };

  // Se borra al momento y el aviso ofrece «Deshacer» (la vuelve a crear con los mismos datos), en vez de preguntar antes.
  const del = async () => {
    if (!op) return;
    try {
      await remove.mutateAsync(op.id);
    } catch (err) {
      return setError((err as Error).message);
    }
    onClose();
    toast(`Operación de ${op.ticker} borrada.`, {
      action: {
        label: 'Deshacer',
        onClick: async () => {
          await api.createOperation(operationInputSchema.parse(op));
          await qc.invalidateQueries();
          toast('Operación recuperada.');
        },
      },
    });
  };

  const brokerOptions = [...new Set([...KNOWN_BROKERS, ...brokers])];
  return (
    <Dialog
      title={op ? 'Editar operación' : 'Nueva operación'}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          {op && (
            <button type="button" className="btn btn--danger-ghost" onClick={del} disabled={remove.isPending}>
              Borrar
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="op-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="op-form" className="form" onSubmit={submit} noValidate>
        <fieldset className="form__section">
          <legend>Operación</legend>
          <div className="field field--wide">
            <QuoteSymbolField
              inputId="op-symbol"
              label="Valor"
              autoFocus={!op && !draft}
              value={quoteSymbol}
              onChange={(value) => { setSymbol(value); setName(null); setVerifiedSymbol(null); setWithoutQuote(false); }}
              onPick={pickValue}
              onQuote={acceptQuote}
            />
            {t && !quoteVerified && <label className="check">
              <input type="checkbox" checked={withoutQuote} onChange={(e) => setWithoutQuote(e.target.checked)} />
              Guardar sin precio actualizado (no se podrá valorar esta posición)
            </label>}
          </div>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="op-type">Tipo</label>
              <select id="op-type" className="select" value={type} onChange={(e) => setType(e.target.value as OperationType)} data-autofocus={op ? true : undefined}>
                {OPERATION_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {OPERATION_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="op-date">Fecha</label>
              <input id="op-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="op-ticker">Ticker en tu cartera</label>
              <input id="op-ticker" list="op-tickers" value={ticker} onChange={(e) => {
                setTicker(e.target.value);
                const next = instruments.find((i) => i.ticker === e.target.value.trim().toUpperCase());
                // Al elegir uno que ya tienes se trae su cotización; un ticker nuevo conserva la que se haya buscado.
                if (next || instruments.some((i) => i.symbol && i.symbol === symbol)) {
                  setSymbol(next?.symbol ?? null);
                  setName(next?.name ?? null);
                  setCurrency(next?.currency ?? 'EUR');
                  setVerifiedSymbol(null);
                  setWithoutQuote(false);
                  setFx('');
                }
              }} autoComplete="off" />
              <datalist id="op-tickers">
                {instruments.map((i) => (
                  <option key={i.ticker} value={i.ticker}>
                    {i.name ?? i.ticker}
                  </option>
                ))}
              </datalist>
              <span className="field__help">{known ? (known.name ?? known.symbol ?? ' ') : t ? 'Valor nuevo' : 'Se rellena al elegir el valor'}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="op-currency">Divisa del precio</label>
            <input id="op-currency" list="op-currencies" maxLength={3} value={currency} onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setFx(''); }} />
            <datalist id="op-currencies">{['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD'].map((c) => <option key={c} value={c} />)}</datalist>
            <span className="field__help">Se obtiene de la cotización. Comprueba que coincide con la clase y el mercado de tu compra.</span>
          </div>
        </fieldset>

        {transfer && <div className="field">
          <label htmlFor="op-transfer-ref">Referencia del traspaso</label>
          <input id="op-transfer-ref" value={transferRef} onChange={(e) => setTransferRef(e.target.value)} maxLength={100} />
          <span className="field__help">Usa la misma referencia en la salida y la entrada. Solo para traspasos de fondos con diferimiento fiscal: conserva el coste y la fecha de adquisición. Registra primero la salida.</span>
        </div>}
        {(trade || type === 'scrip') && (
          <fieldset className="form__section">
            <legend>Importe {foreign && <span className="muted">({currency} y cambio del día)</span>}</legend>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="op-shares">{type === 'scrip' ? 'Acciones recibidas' : 'Acciones / participaciones'}</label>
                <input id="op-shares" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} />
              </div>
              {trade && (
                <>
                  <div className="field">
                    <label htmlFor="op-price">Precio por unidad ({currency})</label>
                    <input id="op-price" inputMode="decimal" value={priceRaw} onChange={(e) => setPrice(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="op-fees">Comisiones {currency !== 'EUR' ? `(${currency})` : ''}</label>
                    <input id="op-fees" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            {trade && (
              <div className="grid-3">
                {foreign && (
                  <div className="field">
                    <label htmlFor="op-fx">Cambio ({currency} por 1 €)</label>
                    <input id="op-fx" inputMode="decimal" value={fxShown} onChange={(e) => setFx(e.target.value)} />
                    <span className="field__help">
                      {fxTouched
                        ? 'Cambio aplicado por el bróker el día de la operación.'
                        : impliedFx != null
                          ? 'Calculado con el total en € que has puesto.'
                          : fxAuto != null
                            ? 'Cambio de mercado de ese día; pon el de tu bróker si lo tienes.'
                            : 'Cambio aplicado por el bróker el día de la operación.'}
                    </span>
                    {fxOff && (
                      <span className="field__help" role="alert" style={{ color: 'var(--expired-fg)' }}>
                        Se aleja un {Math.round(fxOff * 100)} % del cambio de mercado de ese día ({str(Math.round(marketFx! * 10000) / 10000)}). Revisa que no sea el inverso o un 1 por defecto.
                      </span>
                    )}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="op-amount">{transfer ? 'Total traspasado (€)' : type === 'buy' ? 'Total pagado (€)' : 'Total recibido (€)'}</label>
                  <input
                    id="op-amount"
                    inputMode="decimal"
                    value={amountShown}
                    onChange={(e) => {
                      setAmountTouched(true);
                      setAmount(e.target.value);
                    }}
                  />
                  <span className="field__help">
                    {transfer ? 'Importe que pasa al fondo de destino' : type === 'buy' ? 'Con comisiones' : 'Ya sin comisiones'}, como en el extracto
                    {amountTouched && suggested != null && n(amount) !== suggested && (fxTouched || impliedFx == null) && (
                      <>
                        {' · '}
                        <button type="button" className="link" onClick={() => setAmountTouched(false)}>
                          calcular ({money(suggested, 'EUR', 2)})
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            )}
          </fieldset>
        )}

        {income && (
          <fieldset className="form__section">
            <legend>Cobro (en euros)</legend>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="op-gross">Importe bruto</label>
                <input id="op-gross" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="op-wh-es">Retención España</label>
                <input id="op-wh-es" inputMode="decimal" value={whEs} onChange={(e) => setWhEs(e.target.value)} />
                <span className="field__help">
                  {n(amount) && !whEs ? (
                    <button type="button" className="link" onClick={() => setWhEs(str(round2(n(amount)! * 0.19)))}>
                      19 %: {money(round2(n(amount)! * 0.19), 'EUR', 2)}
                    </button>
                  ) : (
                    ' '
                  )}
                </span>
              </div>
              <div className="field">
                <label htmlFor="op-wh-f">Retención en origen</label>
                <input id="op-wh-f" inputMode="decimal" value={whForeign} onChange={(e) => setWhForeign(e.target.value)} />
                <span className="field__help">Solo valores extranjeros</span>
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="op-fees2">Comisiones (€)</label>
                <input id="op-fees2" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
              </div>
              <div className="field">
                <span className="label">Neto</span>
                <span className="field__value num">
                  {money((n(amount) ?? 0) - (n(whEs) ?? 0) - (n(whForeign) ?? 0) - (n(fees) ?? 0), 'EUR', 2)}
                </span>
              </div>
            </div>
          </fieldset>
        )}

        {type === 'split' && (
          <fieldset className="form__section">
            <legend>Split</legend>
            <div className="field">
              <label htmlFor="op-ratio">Acciones nuevas por cada antigua</label>
              <input id="op-ratio" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
              <span className="field__help">2 = cada acción pasa a ser 2 · 0,1 = contrasplit 10 a 1</span>
            </div>
          </fieldset>
        )}

        <fieldset className="form__section">
          <legend>Más datos</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="op-broker">Bróker</label>
              <input id="op-broker" list="op-brokers" value={broker} onChange={(e) => setBroker(e.target.value)} />
              <datalist id="op-brokers">
                {brokerOptions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="op-dayorder">Orden en el día</label>
              <input id="op-dayorder" inputMode="numeric" value={dayOrder} onChange={(e) => setDayOrder(e.target.value)} placeholder="Opcional" />
              <span className="field__help">1, 2, 3… si ese día hubo varias del mismo valor</span>
            </div>
          </div>
          <div className="field field--wide">
            <label htmlFor="op-notes">Notas</label>
            <input id="op-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Marcar para revisar
          </label>
        </fieldset>

        {error && (
          <p className="error-box" role="alert" ref={errorRef}>
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
