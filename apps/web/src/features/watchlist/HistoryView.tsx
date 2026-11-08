import { HISTORY_RANGES, type HistoryRange, type WatchlistRow } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { HistoryChart, type RefLine } from '../detail/HistoryChart.tsx';

const RANGE_KEY = 'watchlist.ficha.periodo';

/** Gráfico histórico con tus niveles, la orden y los objetivos dibujados encima. */
export function HistoryView({ row }: { row: WatchlistRow }) {
  const { item, targets, metrics } = row;
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

  return (
    <div className="xp-history">
      <div className="segmented segmented--small" role="group" aria-label="Periodo del gráfico">
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
      {history.isError && <p className="error-box">No se pudo cargar el histórico. Prueba otro periodo.</p>}
      {history.data && (
        <>
          <HistoryChart points={history.data.points} refs={refs} range={range} />
          {history.data.stale && <p className="muted small">Sin conexión: se muestra el último histórico guardado.</p>}
        </>
      )}
    </div>
  );
}
