import type { LevelStatus, WatchlistRow } from '@/shared';

/** Línea fija de referencia sobre el gráfico (compras de la lista, orden, coste medio…). */
export interface ChartLine {
  price: number;
  title: string;
  /** Discontinua en el color de acento (por defecto) o punteada en el color del texto. */
  style?: 'dashed' | 'dotted';
  /** Estado de una compra (alcanzada, cerca…), orden u objetivo: la línea toma su color, el mismo de la tabla. */
  status?: LevelStatus | 'order' | 'broker' | 'consensus';
}

/** Operación propia marcada en el gráfico. `date` en AAAA-MM-DD. */
export interface ChartMark {
  date: string;
  side: 'buy' | 'sell';
}

/** Líneas de un valor de la lista: sus compras, la orden activa y los objetivos del bróker y del consenso. */
export const watchlistLines = ({ item, metrics, targets }: WatchlistRow): ChartLine[] => [
  ...metrics.levels.map((l, i) => ({ price: l.price, title: `Compra ${i + 1}`, status: l.status })),
  ...(item.orderActive && item.orderPrice ? [{ price: item.orderPrice, title: 'Orden', style: 'dotted' as const, status: 'order' as const }] : []),
  ...(item.brokerTarget ? [{ price: item.brokerTarget, title: item.brokerName ?? 'Bróker', status: 'broker' as const }] : []),
  ...(targets?.mean ? [{ price: targets.mean, title: 'Consenso', style: 'dotted' as const, status: 'consensus' as const }] : []),
];
