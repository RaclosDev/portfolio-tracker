import { HISTORY_RANGES, type HistoryRange, type WatchlistRow } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { pct, price } from '../../lib/format.ts';
import { HistoryChart, type RefLine } from './HistoryChart.tsx';
import { ValueFacts } from './ValueFacts.tsx';

const RANGE_KEY = 'watchlist.ficha.periodo';

/** Ficha de un valor: gráfico histórico con tus niveles y objetivos, y todos sus datos. */
export function DetailPanel({ row, base, onEdit, onClose }: { row: WatchlistRow; base: string; onEdit: () => void; onClose: () => void }) {
  const { item, quote, targets, metrics } = row;
  const [range, setRange] = useState<HistoryRange>(() => (localStorage.getItem(RANGE_KEY) as HistoryRange) || '1y');
  const history = useQuery({
    queryKey: ['history', item.symbol, range],
    queryFn: () => api.history(item.symbol, range),
    staleTime: 10 * 60_000,
  });

  const refs: RefLine[] = [
    ...metrics.levels.map((l, i) => ({ label: `Compra ${i + 1}`, value: l.price, kind: l.status })),
    ...(item.orderActive && item.orderPrice ? [{ label: 'Orden', value: item.orderPrice, kind: 'order' as const }] : []),
    ...(item.brokerTarget ? [{ label: item.brokerName ?? 'Bróker', value: item.brokerTarget, kind: 'broker' as const }] : []),
    ...(targets?.mean ? [{ label: 'Consenso', value: targets.mean, kind: 'consensus' as const }] : []),
  ];
  const name = item.name ?? quote?.name ?? item.symbol;

  return (
    <Dialog
      title={name}
      onClose={onClose}
      className="dialog--drawer"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="btn btn--primary" onClick={onEdit}>
            Editar
          </button>
        </>
      }
    >
      <div className="detail__head">
        <div>
          <span className="ticker">{item.symbol}</span>
          {quote?.exchange && <span className="muted"> · {quote.exchange}</span>}
          {quote?.currency && <span className="muted"> · {quote.currency}</span>}
        </div>
        <div className="detail__price">
          <span className="num strong">{price(quote?.price)}</span>{' '}
          {quote?.changePct != null && (
            <span className={`delta ${quote.changePct >= 0 ? 'up' : 'down'}`}>{pct(quote.changePct, 2)} hoy</span>
          )}
        </div>
      </div>

      <div className="segmented detail__ranges" role="group" aria-label="Periodo del gráfico">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={range === r.id ? 'on' : ''}
            aria-pressed={range === r.id}
            onClick={() => {
              setRange(r.id);
              localStorage.setItem(RANGE_KEY, r.id);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {history.isPending && <p className="muted chart-empty">Cargando el histórico…</p>}
      {history.isError && <p className="error-box">No se pudo cargar el histórico. Prueba otro periodo o vuelve a abrir la ficha.</p>}
      {history.data && (
        <>
          <HistoryChart points={history.data.points} refs={refs} range={range} />
          {history.data.stale && <p className="muted small">Sin conexión: se muestra el último histórico guardado.</p>}
        </>
      )}

      <ValueFacts row={row} base={base} />
    </Dialog>
  );
}
