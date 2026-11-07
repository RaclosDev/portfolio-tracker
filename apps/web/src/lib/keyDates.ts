import type { WatchlistRow } from '@watchlist/shared';
import { daysUntil } from './format.ts';

export interface KeyDate {
  kind: 'earnings' | 'exDividend';
  date: string;
  days: number;
}

export const KEY_DATE_LABEL: Record<KeyDate['kind'], string> = { earnings: 'Resultados', exDividend: 'Ex-dividendo' };

/** Próximas fechas clave (resultados y ex-dividendo) que aún no han pasado, la más cercana primero. */
export function upcoming(r: WatchlistRow): KeyDate[] {
  const out: KeyDate[] = [];
  for (const kind of ['earnings', 'exDividend'] as const) {
    const date = kind === 'earnings' ? r.targets?.nextEarnings : r.targets?.exDividend;
    const days = daysUntil(date);
    if (date && days != null && days >= 0) out.push({ kind, date, days });
  }
  return out.sort((a, b) => a.days - b.days);
}
