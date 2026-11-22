import { type HistoryRange, type Operation } from '@/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { avgPrice, money, qty, pct } from '../../lib/format.ts';
import { HistoryChart, type RefLine } from '../detail/HistoryChart.tsx';
import { signed, type CarteraModel } from './model.ts';
import { FundHoldings, InstrumentForm, LotsTable, OperationActions, OperationsTable, compositionSource, useTicker } from './TickerParts.tsx';
import type { OperationDraft } from './OperationDialog.tsx';

/** Ficha de un valor de la cartera en un diálogo (desde Exposición): datos, lotes, operaciones y gráfico. */
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
  onAddOperation: (draft: OperationDraft) => void;
}) {
  const { t, row, inst, composition, ops, cur, fxRate, lastBroker, valueEur, avgNative } = useTicker(model, ticker);
  const range: HistoryRange = '5y';
  const sym = inst?.symbol;
  const history = useQuery({
    queryKey: ['history', sym, range],
    queryFn: () => api.history(sym!, range),
    enabled: !!sym,
    staleTime: 10 * 60_000,
  });

  if (!t) return null;
  const refs: RefLine[] = avgNative ? [{ label: 'Coste medio', value: avgNative, kind: 'price' }] : [];

  return (
    <Dialog title={`${row?.name ?? ticker} · ${ticker}`} onClose={onClose} wide className="dialog--xl">
      <section className="highlights ticker-hl" aria-label="Resumen del valor">
        <div className="hl-cell">
          <p className="hl-label">Acciones</p>
          <p className="hl-figure num">{qty(t.shares)}</p>
        </div>
        <div className="hl-cell">
          <p className="hl-label">Coste medio</p>
          <p className="hl-figure num">{avgNative ? avgPrice(avgNative, cur) : '–'}</p>
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

      {composition && composition.holdings.length > 0 && (
        <>
          <h3 className="renta__h">
            Qué lleva dentro · {composition.holdings.length} posiciones
            <span className="sub"> {compositionSource(composition)}</span>
          </h3>
          <FundHoldings composition={composition} valueEur={valueEur} />
        </>
      )}

      {t.openLots.length > 0 && (
        <>
          <h3 className="renta__h">Lotes en cartera (FIFO: se venden primero los más antiguos)</h3>
          <LotsTable t={t} cur={cur} fxRate={fxRate} />
        </>
      )}

      <div className="toolbar" style={{ marginTop: 14 }}>
        <h3 className="renta__h" style={{ margin: 0 }}>
          Operaciones ({ops.length})
        </h3>
        <span className="spacer" />
        <OperationActions ticker={ticker} t={t} lastBroker={lastBroker} onAdd={onAddOperation} />
      </div>
      <OperationsTable ops={ops} t={t} cur={cur} onEdit={onEditOperation} />

      <InstrumentForm model={model} ticker={ticker} />
    </Dialog>
  );
}
