const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** ISIN escrito dentro de un símbolo de cotización (`XETRA:IE00B4L5Y983`, `FT:IE00B4L5Y983:EUR`) o el propio ISIN. */
export const isinInSymbol = (symbol: string | null | undefined) =>
  symbol?.trim().toUpperCase().split(':').find((part) => ISIN.test(part)) ?? null;

/**
 * Ticker legible de un símbolo de cotización, el que se enseña y se propone para la cartera:
 * `FT:SEC0:GER:EUR` → SEC0, `XETRA:IE00B4L5Y983` → el ISIN, `TEF.MC` → TEF, `GRF-P.MC` → GRF.P.
 * Los de otras bolsas conservan el sufijo (`SEC0.DE`): es lo que los distingue.
 */
export function tickerFromSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const colon = s.indexOf(':');
  if (colon > 0) return s.slice(colon + 1).split(':')[0] || s;
  return s.replace(/\.MC$/, '').replace(/-P$/, '.P');
}

/** Ticker con el que se enseña un valor de la lista: el guardado o, si no hay, el de su cotización. */
export const displayTicker = (v: { ticker?: string | null; symbol: string }) => v.ticker || tickerFromSymbol(v.symbol);
