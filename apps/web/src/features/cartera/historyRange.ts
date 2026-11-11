export const HISTORY_PERIODS = [
  { id: '1m', label: '1 mes', months: 1 },
  { id: '3m', label: '3 meses', months: 3 },
  { id: '6m', label: '6 meses', months: 6 },
  { id: '1y', label: '1 año', months: 12 },
  { id: '2y', label: '2 años', months: 24 },
  { id: '5y', label: '5 años', months: 60 },
  { id: 'all', label: 'Todo', months: 0 },
] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number]['id'];

export function periodStart(period: HistoryPeriod, today: string, first: string): string {
  if (period === 'all') return first;
  const months = HISTORY_PERIODS.find((p) => p.id === period)!.months;
  const date = new Date(`${today}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return [first, date.toISOString().slice(0, 10)].sort()[1]!;
}
