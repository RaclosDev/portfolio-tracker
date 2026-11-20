/** El cambio es unidades de la divisa por euro; sin cambio no se propone un total extranjero. */
export function tradeTotal(type: 'buy' | 'sell', shares: number | null, price: number | null, fees: number, currency: string, fx: number | null): number | null {
  const rate = currency === 'EUR' ? 1 : fx;
  if (shares == null || price == null || shares <= 0 || price < 0 || !rate || rate <= 0) return null;
  const total = (shares * price + (type === 'buy' ? fees : -fees)) / rate;
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null;
}
