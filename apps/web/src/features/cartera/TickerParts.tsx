import { OPERATION_LABELS, averageNativePrice, sortOperations, type Operation, type Quote, type TickerLedger } from '@watchlist/shared';
import { useCallback, useState, type FormEvent } from 'react';
import { useOperationMutations, usePortfolioComposition } from '../../api/hooks.ts';
import { money, qty, price, share, shortDate } from '../../lib/format.ts';
import { signed, type CarteraModel } from './model.ts';
import { DataBar } from './SortTable.tsx';
import { QuoteSymbolField } from './QuoteSymbolField.tsx';
import type { OperationDraft } from './OperationDialog.tsx';

/** Posiciones del fondo que se ven sin desplegar la lista entera. */
const HOLDINGS_SHOWN = 25;

/** Todo lo que la ficha de un valor necesita de la cartera. */
export function useTicker(model: CarteraModel, ticker: string) {
  const t = model.ledger.byTicker.get(ticker);
  const row = [...model.valuation.open, ...model.valuation.closed].find((r) => r.ticker === ticker);
  const inst = model.view.instruments.find((i) => i.ticker === ticker);
  const composition = usePortfolioComposition(t ? t.shares > 0 : false).data?.[ticker];
  const ops = sortOperations(model.view.operations.filter((o) => o.ticker === ticker)).reverse();
  const cur = row?.currency ?? inst?.currency ?? 'EUR';
  const fxRate = row?.fxRate ?? null;
  return {
    t,
    row,
    inst,
    composition,
    ops,
    cur,
    fxRate,
    lastBroker: ops.find((o) => o.broker)?.broker ?? null,
    valueEur: row && 'valueEur' in row ? row.valueEur : null,
    // Con el cambio de cada compra: con el de hoy, el precio medio en dólares cambiaría cada día con el euro.
    avgNative: t ? averageNativePrice(t, cur, fxRate) : null,
  };
}
export type TickerData = ReturnType<typeof useTicker>;
type Composition = NonNullable<TickerData['composition']>;

export function FundHoldings({ composition, valueEur }: { composition: Composition; valueEur: number | null }) {
  const [all, setAll] = useState(false);
  const known = composition.holdings.reduce((s, h) => s + h.weight, 0);
  return (
    <div className="table-wrap">
      <table className="wl-table cartera-table fund-holdings">
        <thead>
          <tr>
            <th>Empresa</th>
            <th className="al-right">Peso</th>
            <th className="al-right" title="Lo que te toca de esa empresa por tener este fondo">
              Tu parte
            </th>
          </tr>
        </thead>
        <tbody>
          {(all ? composition.holdings : composition.holdings.slice(0, HOLDINGS_SHOWN)).map((h) => (
            <tr key={h.isin ?? h.name}>
              <td>
                {h.name}
                {(h.ticker ?? h.isin) && <span className="sub"> {h.ticker ?? h.isin}</span>}
              </td>
              <td className="al-right">
                <DataBar value={h.weight} max={composition.holdings[0]!.weight}>
                  <span className="num">{share(h.weight, 2)}</span>
                </DataBar>
              </td>
              <td className="al-right num">{valueEur != null ? money(valueEur * h.weight, 'EUR', 2) : '–'}</td>
            </tr>
          ))}
          {!all && composition.holdings.length > HOLDINGS_SHOWN && (
            <tr>
              <td colSpan={3}>
                <button type="button" className="link-btn" onClick={() => setAll(true)}>
                  Ver las {composition.holdings.length} posiciones
                </button>
              </td>
            </tr>
          )}
          <tr className="fund-holdings__rest">
            <td className="muted">Resto sin desglosar</td>
            <td className="al-right num">{share(Math.max(0, 1 - known), 2)}</td>
            <td className="al-right num">{valueEur != null ? money(valueEur * Math.max(0, 1 - known), 'EUR', 2) : '–'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function compositionSource(c: Composition) {
  return `${c.source}${c.asOf ? ` · ${shortDate(c.asOf)}` : ''}`;
}

/** Lotes FIFO que siguen en cartera. `compact` quita las columnas que no caben en el panel estrecho; `tiny` (móvil) pone el precio medio bajo el coste. */
export function LotsTable({ t, cur, fxRate, compact, tiny }: { t: TickerLedger; cur: string; fxRate: number | null; compact?: boolean; tiny?: boolean }) {
  compact ||= tiny;
  return (
    <div className="table-wrap">
      <table className="wl-table cartera-table ticker-lots">
        <thead>
          <tr>
            <th>Compra</th>
            {!compact && <th>Bróker</th>}
            <th className="al-right">Acciones</th>
            <th className="al-right">Coste</th>
            {!compact && <th className="al-right">Coste fiscal</th>}
            {!tiny && <th className="al-right">Precio medio</th>}
          </tr>
        </thead>
        <tbody>
          {t.openLots.map((l) => (
            <tr key={l.id}>
              <td className="num">
                {shortDate(l.date)}
                {compact && l.broker && <span className="sub"> {l.broker}</span>}
              </td>
              {!compact && <td>{l.broker ?? '–'}</td>}
              <td className="al-right num">{qty(l.shares)}</td>
              <td className="al-right num" title={compact ? `Coste fiscal ${money(l.taxCostEur, 'EUR', 2)}` : undefined}>
                {money(l.costEur, 'EUR', 2)}
                {tiny && <span className="sub">a {price(averageNativePrice({ openLots: [l] }, cur, fxRate), cur)}</span>}
              </td>
              {!compact && (
                <td className="al-right num" title={l.deferredLossEur ? `Incluye ${money(l.deferredLossEur, 'EUR', 2)} de pérdida aplazada` : undefined}>
                  {money(l.taxCostEur, 'EUR', 2)}
                </td>
              )}
              {!tiny && <td className="al-right num">{price(averageNativePrice({ openLots: [l] }, cur, fxRate), cur)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Botones para apuntar otra operación del valor, ya rellena con lo que se sabe. */
export function OperationActions({ ticker, t, lastBroker, onAdd }: { ticker: string; t: TickerLedger; lastBroker: string | null; onAdd: (d: OperationDraft) => void }) {
  return (
    <>
      {t.shares > 0 && (
        <>
          <button type="button" className="btn btn--small" onClick={() => onAdd({ ticker, type: 'buy', broker: lastBroker })}>
            Comprar más
          </button>
          <button type="button" className="btn btn--small" onClick={() => onAdd({ ticker, type: 'sell', shares: t.shares, broker: lastBroker })}>
            Vender
          </button>
        </>
      )}
      <button type="button" className="btn btn--small" onClick={() => onAdd({ ticker, broker: lastBroker })}>
        Otra operación
      </button>
    </>
  );
}

/**
 * Operaciones del valor. `compact` quita precio y bróker; `tiny` (móvil) deja tres columnas y pone
 * las acciones bajo la operación y el resultado bajo el importe.
 */
export function OperationsTable({ ops, t, cur, onEdit, compact, tiny }: { ops: Operation[]; t: TickerLedger; cur: string; onEdit: (op: Operation) => void; compact?: boolean; tiny?: boolean }) {
  compact ||= tiny;
  return (
    <div className="table-wrap ticker-ops">
      <table className="wl-table cartera-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>{tiny ? 'Operación' : 'Tipo'}</th>
            {!tiny && <th className="al-right">Acciones</th>}
            {!compact && <th className="al-right">Precio</th>}
            <th className="al-right">Importe €</th>
            {!tiny && (
              <th className="al-right" title="Ganancia o pérdida de la venta">
                Resultado
              </th>
            )}
            {!compact && <th>Bróker</th>}
          </tr>
        </thead>
        <tbody>
          {ops.map((o) => {
            const sale = t.sales.find((s) => s.id === o.id);
            return (
              <tr key={o.id} className="row row--click" onClick={() => onEdit(o)} title={compact && o.price ? `${price(o.price, cur)}${o.broker ? ` · ${o.broker}` : ''}` : undefined}>
                <td className="num">
                  <button
                    type="button"
                    className="cell-link"
                    aria-label={`Editar ${OPERATION_LABELS[o.type]} del ${shortDate(o.date)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(o);
                    }}
                  >
                    {shortDate(o.date)}
                  </button>
                  {o.dayOrder != null && <span className="sub" title="Orden en el día"> ·{o.dayOrder}</span>}
                </td>
                <td>
                  {OPERATION_LABELS[o.type]}
                  {tiny && o.shares ? <span className="sub num">{qty(o.shares)} acciones</span> : null}
                </td>
                {!tiny && <td className="al-right num">{o.shares ? qty(o.shares) : ''}</td>}
                {!compact && <td className="al-right num">{o.price ? price(o.price, cur) : ''}</td>}
                <td className="al-right num">
                  {o.amountEur ? money(o.amountEur, 'EUR', 2) : ''}
                  {tiny && sale && <span className={`sub delta ${signed(sale.gainEur)}`}>{money(sale.gainEur, 'EUR', 2)}</span>}
                </td>
                {!tiny && <td className={`al-right num delta ${signed(sale?.gainEur)}`}>{sale ? money(sale.gainEur, 'EUR', 2) : ''}</td>}
                {!compact && <td>{o.broker ?? ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Datos editables del valor: nombre, símbolo de cotización, sector, divisa y notas. */
export function InstrumentForm({ model, ticker, compact }: { model: CarteraModel; ticker: string; compact?: boolean }) {
  const inst = model.view.instruments.find((i) => i.ticker === ticker);
  const { updateInstrument } = useOperationMutations();
  const [name, setName] = useState(inst?.name ?? '');
  const [symbol, setSymbol] = useState(inst?.symbol ?? '');
  const [sector, setSector] = useState(inst?.sector ?? '');
  const [currency, setCurrency] = useState(inst?.currency ?? 'EUR');
  const [notes, setNotes] = useState(inst?.notes ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const acceptQuote = useCallback((quote: Quote | null) => {
    if (!quote) return;
    setName((current) => current || quote.name || '');
    if (quote.currency) setCurrency(quote.currency);
  }, []);
  const sectors = [...new Set(model.view.instruments.map((i) => i.sector).filter((s): s is string => !!s))].sort();
  const grid = compact ? 'form-pair' : 'grid-3';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await updateInstrument.mutateAsync({
        ticker,
        patch: {
          name: name.trim() || null,
          symbol: symbol.trim() || null,
          sector: sector.trim() || null,
          currency: currency.trim().toUpperCase() || 'EUR',
          notes: notes.trim() || null,
        },
      });
      setMsg('Guardado.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const currencyField = (
    <div className={compact ? 'field field--short' : 'field'}>
      <label htmlFor={`tk-cur-${ticker}`}>Divisa</label>
      <input id={`tk-cur-${ticker}`} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />
    </div>
  );

  // En el panel estrecho la ayuda de la cotización ocupa todo el ancho, y Sector y Divisa van juntos.
  const fields = (
    <>
      <div className={grid}>
        <div className={compact ? 'field field--wide' : 'field'}>
          <label htmlFor={`tk-name-${ticker}`}>Nombre</label>
          <input id={`tk-name-${ticker}`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={compact ? 'field field--wide' : 'field'}>
          <QuoteSymbolField inputId={`tk-symbol-${ticker}`} value={symbol} onChange={setSymbol} onPick={(r) => { if (!name) setName(r.name); }} onQuote={acceptQuote} />
        </div>
        <div className="field">
          <label htmlFor={`tk-sector-${ticker}`}>Sector</label>
          <input id={`tk-sector-${ticker}`} list={`tk-sectors-${ticker}`} value={sector} onChange={(e) => setSector(e.target.value)} />
          <datalist id={`tk-sectors-${ticker}`}>
            {sectors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        {compact && currencyField}
      </div>
      <div className={grid}>
        {!compact && currencyField}
        <div className={compact ? 'field field--wide' : 'field'} style={compact ? undefined : { gridColumn: 'span 2' }}>
          <label htmlFor={`tk-notes-${ticker}`}>Notas</label>
          {compact ? (
            <textarea id={`tk-notes-${ticker}`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          ) : (
            <input id={`tk-notes-${ticker}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </div>
      </div>
      <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="submit" className="btn btn--primary" disabled={updateInstrument.isPending}>
          Guardar datos
        </button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </>
  );

  return (
    <form className="form" onSubmit={save} style={compact ? undefined : { marginTop: 10 }}>
      {compact ? (
        fields
      ) : (
        <fieldset className="form__section">
          <legend>Datos del valor</legend>
          {fields}
        </fieldset>
      )}
    </form>
  );
}
