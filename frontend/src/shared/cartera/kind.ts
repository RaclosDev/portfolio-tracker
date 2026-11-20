/** Tipo de valor para filtrar: acción, ETF, fondo u otra cosa (índice, divisa, cripto…). */
export type InstrumentKind = 'EQUITY' | 'ETF' | 'FUND' | 'OTHER';

const ISIN = '[A-Z]{2}[A-Z0-9]{9}[0-9]';
/** Símbolos que solo usan los fondos: el ISIN a secas, el código de Morningstar (0P…) y el de FT con ISIN y divisa. */
const FUND_SYMBOL = new RegExp(`^(?:${ISIN}|0P[0-9A-Z]{8}(?:[.][A-Z]{1,3})?|FT:${ISIN}:[A-Z]{3})$`);

/** Tipo según el mercado (quoteType de la cotización). */
export function kindOfQuoteType(quoteType: string | null | undefined): InstrumentKind | null {
  switch (quoteType?.toUpperCase()) {
    case 'EQUITY': return 'EQUITY';
    case 'ETF': return 'ETF';
    case 'MUTUALFUND': case 'FUND': return 'FUND';
    case undefined: case '': return null;
    default: return 'OTHER';
  }
}

/**
 * Tipo de un valor de la cartera. Manda la cotización; lo ya vendido no la tiene, y entonces se deduce del símbolo
 * (los fondos se siguen por ISIN o código de Morningstar) y del nombre. Lo que no parece un fondo es una acción.
 */
export function instrumentKind(
  instrument: { symbol?: string | null; ticker: string; name?: string | null },
  quoteType?: string | null,
): InstrumentKind {
  const known = kindOfQuoteType(quoteType);
  if (known) return known;
  const symbol = (instrument.symbol ?? instrument.ticker).trim().toUpperCase();
  const name = instrument.name ?? '';
  if (/\b(ETF|ETC|ETN)\b/i.test(name)) return 'ETF';
  if (FUND_SYMBOL.test(symbol)) return 'FUND';
  if (/\b(FI|FIL|SICAV|PP|Fund|Fonds|Fondo)\b/.test(name)) return 'FUND';
  if (/\bUCITS\b/i.test(name)) return 'ETF';
  return 'EQUITY';
}
