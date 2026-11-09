import {
  isIncome,
  KNOWN_BROKERS,
  localToday,
  OPERATION_LABELS,
  OPERATION_TYPES,
  type Instrument,
  type Operation,
  type OperationInput,
  type OperationType,
} from '@watchlist/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { useOperationMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { money, parseDecimal } from '../../lib/format.ts';

/** Datos con los que abrir el alta (p. ej. «Lo he comprado» desde la lista de vigilancia). */
export interface OperationDraft {
  type?: OperationType;
  ticker?: string;
  symbol?: string;
  name?: string | null;
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

/** Ticker que se propone para un símbolo de Yahoo (TEF.MC → TEF, GRF-P.MC → GRF.P). */
export const tickerFromSymbol = (symbol: string) => symbol.toUpperCase().replace(/\.MC$/, '').replace(/-P$/, '.P');

/** Alta y edición de una operación del registro (compra, venta, dividendo…). */
export function OperationDialog({ operation: op, draft, instruments, brokers, onClose }: Props) {
  const { save, remove } = useOperationMutations();
  const [type, setType] = useState<OperationType>(op?.type ?? draft?.type ?? 'buy');
  const [date, setDate] = useState(op?.date ?? draft?.date ?? localToday());
  const [ticker, setTicker] = useState(op?.ticker ?? draft?.ticker ?? '');
  const [symbol, setSymbol] = useState(draft?.symbol ?? '');
  const [shares, setShares] = useState(str(op?.shares ?? draft?.shares));
  const [priceRaw, setPrice] = useState(str(op?.price ?? draft?.price));
  const [fees, setFees] = useState(str(op?.fees || null));
  const [fx, setFx] = useState(str(op && op.fxRate !== 1 ? op.fxRate : null));
  const [amount, setAmount] = useState(str(op?.amountEur));
  const [amountTouched, setAmountTouched] = useState(!!op);
  const [whEs, setWhEs] = useState(str(op?.withholdingEs));
  const [whForeign, setWhForeign] = useState(str(op?.withholdingForeign));
  const [ratio, setRatio] = useState(str(op?.splitRatio));
  const [broker, setBroker] = useState(op?.broker ?? draft?.broker ?? '');
  const [notes, setNotes] = useState(op?.notes ?? '');
  const [review, setReview] = useState(op?.needsReview ?? false);
  const [error, setError] = useState<string | null>(null);

  const t = ticker.trim().toUpperCase();
  const known = instruments.find((i) => i.ticker === t);
  const currency = known?.currency ?? 'EUR';
  const foreign = currency !== 'EUR' || !!fx;
  const income = isIncome(type);
  const trade = type === 'buy' || type === 'sell';

  // Importe en euros propuesto a partir de acciones, precio, comisiones y cambio (se puede corregir).
  const n = (s: string) => parseDecimal(s);
  const fxN = n(fx) || 1;
  const suggested =
    trade && n(shares) && n(priceRaw)
      ? round2((n(shares)! * n(priceRaw)! + (type === 'buy' ? 1 : -1) * (n(fees) ?? 0)) / fxN)
      : null;
  const amountShown = amountTouched ? amount : suggested != null ? str(suggested) : amount;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!t) return setError('Indica el ticker.');
    const data: OperationInput = {
      date,
      ticker: t,
      type,
      shares: trade || type === 'scrip' ? n(shares) : null,
      price: trade ? n(priceRaw) : null,
      fees: n(fees) ?? 0,
      fxRate: fxN,
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
    };
    try {
      await save.mutateAsync({
        id: op?.id,
        data,
        instrument: known ? undefined : { symbol: symbol.trim() || null, name: draft?.name ?? null, currency: fx ? 'USD' : 'EUR' },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.issues?.length ? err.issues.map((i) => i.message).join(' · ') : (err as Error).message);
    }
  };

  const del = async () => {
    if (!op || !confirm('¿Borrar esta operación del registro?')) return;
    try {
      await remove.mutateAsync(op.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const brokerOptions = [...new Set([...KNOWN_BROKERS, ...brokers])];
  return (
    <Dialog
      title={op ? 'Editar operación' : 'Nueva operación'}
      onClose={onClose}
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
          <div className="grid-3">
            <div className="field">
              <label htmlFor="op-type">Tipo</label>
              <select id="op-type" className="select" value={type} onChange={(e) => setType(e.target.value as OperationType)} data-autofocus>
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
              <label htmlFor="op-ticker">Ticker</label>
              <input id="op-ticker" list="op-tickers" value={ticker} onChange={(e) => setTicker(e.target.value)} autoComplete="off" />
              <datalist id="op-tickers">
                {instruments.map((i) => (
                  <option key={i.ticker} value={i.ticker}>
                    {i.name ?? i.ticker}
                  </option>
                ))}
              </datalist>
              <span className="field__help">{known ? (known.name ?? known.symbol ?? ' ') : t ? 'Valor nuevo' : ' '}</span>
            </div>
          </div>
          {!known && t && (
            <div className="field field--wide">
              <label htmlFor="op-symbol">Símbolo en Yahoo Finance (para el precio)</label>
              <input id="op-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={`${t}.MC`} />
            </div>
          )}
        </fieldset>

        {(trade || type === 'scrip') && (
          <fieldset className="form__section">
            <legend>Importe {foreign && <span className="muted">({currency} y cambio del día)</span>}</legend>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="op-shares">{type === 'scrip' ? 'Acciones recibidas' : 'Acciones'}</label>
                <input id="op-shares" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} />
              </div>
              {trade && (
                <>
                  <div className="field">
                    <label htmlFor="op-price">Precio {currency !== 'EUR' ? `(${currency})` : ''}</label>
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
                    <input id="op-fx" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="op-amount">{type === 'buy' ? 'Total pagado (€)' : 'Total recibido (€)'}</label>
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
                    {type === 'buy' ? 'Con comisiones' : 'Ya sin comisiones'}, como en el extracto
                    {amountTouched && suggested != null && n(amount) !== suggested && (
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
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="op-notes">Notas</label>
              <input id="op-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Marcar para revisar
          </label>
        </fieldset>

        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
