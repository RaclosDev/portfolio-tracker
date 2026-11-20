import { tickerFromSymbol, type Instrument } from '@/shared';

/** Ticker para un valor nuevo: el corto de su cotización (SAN.MC → SAN) o, si ya lo usa otro valor, el símbolo entero. */
export function proposeTicker(symbol: string, instruments: Pick<Instrument, 'ticker'>[]): string {
  const short = tickerFromSymbol(symbol).slice(0, 32);
  return instruments.some((i) => i.ticker === short) ? symbol.slice(0, 32) : short;
}
