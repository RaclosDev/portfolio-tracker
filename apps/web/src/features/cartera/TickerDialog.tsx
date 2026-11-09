import { OPERATION_LABELS, type HistoryRange, type Operation } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client.ts';
import { useOperationMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { money, num, pct, price, shortDate } from '../../lib/format.ts';
import { HistoryChart, type RefLine } from '../detail/HistoryChart.tsx';
import { signed, type CarteraModel } from './model.ts';

/** Ficha de un valor de la cartera: datos editables, lotes FIFO abiertos, ventas, cobros y gráfico. */
export function TickerDialog({
  model,
  ticker,
  onClose,
  onEditOperation,
  onAddOperation,
}: {
  model: CarteraModel;
  ticker: string;
  onClose: () => void;
  onEditOperation: (op: Operation) => void;
  onAddOperation: (ticker: string) => void;
}) {
  const t = model.ledger.byTicker.get(ticker);
  const row = [...model.valuation.open, ...model.valuation.closed].find((r) => r.ticker === ticker);
  const inst = model.view.instruments.find((i) => i.ticker === ticker);
  const { updateInstrument } = useOperationMutations();
  const [name, setName] = useState(inst?.name ?? '');
  const [symbol, setSymbol] = useState(inst?.symbol ?? '');
  const [sector, setSector] = useState(inst?.sector ?? '');
  const [currency, setCurrency] = useState(inst?.currency ?? 'EUR');
  const [notes, setNotes] = useState(inst?.notes ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const range: HistoryRange = '5y';
  const sym = inst?.symbol;
  const history = useQuery({
    queryKey: ['history', sym, range],
    queryFn: () => api.history(sym!, range),
    enabled: !!sym,
    staleTime: 10 * 60_000,
  });

  if (!t) return null;
  const ops = model.view.operations.filter((o) => o.ticker === ticker).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const fx = row?.fxRate ?? 1;
  const avgNative = t.shares > 0 ? (t.costEur / t.shares) * fx : null;
  const refs: RefLine[] = avgNative ? [{ label: 'Coste medio', value: avgNative, kind: 'price' }] : [];
  const sectors = [...new Set(model.view.instruments.map((i) => i.sector).filter((s): s is string => !!s))].sort();

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

  return (
    <Dialog title={`${row?.name ?? ticker} · ${ticker}`} onClose={onClose} wide className="dialog--xl">
      <section className="highlights ticker-hl" aria-label="Resumen del valor">
        <div className="hl-cell">
          <p className="hl-label">Acciones</p>
          <p className="hl-figure num">{num(t.shares, Number.isInteger(t.shares) ? 0 : 3)}</p>
        </div>
        <div className="hl-cell">
          <p className="hl-label">Coste medio</p>
          <p className="hl-figure num">{avgNative ? price(avgNative, row?.currency ?? inst?.currency ?? 'EUR') : '–'}</p>
        </div>
        {row && 'valueEur' in row && (
          <div className="hl-cell">
            <p className="hl-label">Latente</p>
            <p className={`hl-figure num delta ${signed(row.unrealizedEur)}`}>
              {money(row.unrealizedEur, 'EUR', 2)} <small>{pct(row.unrealizedPct)}</small>
            </p>
          </div>
        )}
        <div className="hl-cell">
          <p className="hl-label">Ventas</p>
          <p className={`hl-figure num delta ${signed(t.realizedEur)}`}>{money(t.realizedEur, 'EUR', 2)}</p>
        </div>
        <div className="hl-cell">
          <p className="hl-label">Cobros</p>
          <p className="hl-figure num">{money(t.dividendsEur + t.otherIncomeEur, 'EUR', 2)}</p>
        </div>
      </section>

      {sym && history.data && history.data.points.length > 1 && (
        <HistoryChart points={history.data.points} refs={refs} range={range} current={row?.price} currency={row?.currency} />
      )}

      {t.openLots.length > 0 && (
        <>
          <h3 className="renta__h">Lotes en cartera (FIFO: se venden primero los más antiguos)</h3>
          <div className="table-wrap">
            <table className="wl-table cartera-table">
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Bróker</th>
                  <th className="al-right">Acciones</th>
                  <th className="al-right">Coste</th>
                  <th className="al-right">Coste fiscal</th>
                  <th className="al-right">Precio medio</th>
                </tr>
              </thead>
              <tbody>
                {t.openLots.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{shortDate(l.date)}</td>
                    <td>{l.broker ?? '–'}</td>
                    <td className="al-right num">{num(l.shares, Number.isInteger(l.shares) ? 0 : 3)}</td>
                    <td className="al-right num">{money(l.costEur, 'EUR', 2)}</td>
                    <td className="al-right num" title={l.deferredLossEur ? `Incluye ${money(l.deferredLossEur, 'EUR', 2)} de pérdida aplazada` : undefined}>
                      {money(l.taxCostEur, 'EUR', 2)}
                    </td>
                    <td className="al-right num">{price((l.costEur / l.shares) * fx, row?.currency ?? inst?.currency ?? 'EUR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="toolbar" style={{ marginTop: 14 }}>
        <h3 className="renta__h" style={{ margin: 0 }}>
          Operaciones ({ops.length})
        </h3>
        <span className="spacer" />
        <button type="button" className="btn btn--small" onClick={() => onAddOperation(ticker)}>
          Añadir operación
        </button>
      </div>
      <div className="table-wrap ticker-ops">
        <table className="wl-table cartera-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th className="al-right">Acciones</th>
              <th className="al-right">Precio</th>
              <th className="al-right">Importe €</th>
              <th className="al-right" title="Ganancia o pérdida de la venta">
                Resultado
              </th>
              <th>Bróker</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => {
              const sale = t.sales.find((s) => s.id === o.id);
              return (
                <tr key={o.id} className="row row--click" onClick={() => onEditOperation(o)}>
                  <td className="num">{shortDate(o.date)}</td>
                  <td>{OPERATION_LABELS[o.type]}</td>
                  <td className="al-right num">{o.shares ? num(o.shares, Number.isInteger(o.shares) ? 0 : 3) : ''}</td>
                  <td className="al-right num">{o.price ? price(o.price, row?.currency ?? inst?.currency ?? 'EUR') : ''}</td>
                  <td className="al-right num">{o.amountEur ? money(o.amountEur, 'EUR', 2) : ''}</td>
                  <td className={`al-right num delta ${signed(sale?.gainEur)}`}>{sale ? money(sale.gainEur, 'EUR', 2) : ''}</td>
                  <td>{o.broker ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form className="form" onSubmit={save} style={{ marginTop: 10 }}>
        <fieldset className="form__section">
          <legend>Datos del valor</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="tk-name">Nombre</label>
              <input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="tk-symbol">Símbolo Yahoo</label>
              <input id="tk-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={`${ticker}.MC`} />
            </div>
            <div className="field">
              <label htmlFor="tk-sector">Sector</label>
              <input id="tk-sector" list="tk-sectors" value={sector} onChange={(e) => setSector(e.target.value)} />
              <datalist id="tk-sectors">
                {sectors.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="tk-cur">Divisa</label>
              <input id="tk-cur" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="tk-notes">Notas</label>
              <input id="tk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="submit" className="btn btn--primary" disabled={updateInstrument.isPending}>
              Guardar datos
            </button>
            {msg && <span className="muted small">{msg}</span>}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
