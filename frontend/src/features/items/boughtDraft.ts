import { displayTicker, localToday, type WatchlistRow } from '@/shared';
import type { OperationDraft } from '../cartera/OperationDialog.tsx';

/** «Lo he comprado»: el alta en la cartera con la compra prevista (acciones y precio de entrada) y fecha de hoy. */
export function boughtDraft(row: WatchlistRow, isin?: string | null): OperationDraft {
  const { item, metrics } = row;
  return {
    type: 'buy',
    ticker: displayTicker(item),
    symbol: item.symbol,
    isin: item.isin ?? isin ?? row.quote?.isin ?? null,
    name: item.name,
    shares: metrics.shares ?? undefined,
    price: metrics.entryPrice ?? undefined,
    date: localToday(),
  };
}
