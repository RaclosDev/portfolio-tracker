/** Traducción de los símbolos de la app al formato «BOLSA:TICKER» de TradingView. */

/** Sufijo de Yahoo → bolsa de TradingView. */
const YAHOO: Record<string, string> = {
  MC: 'BME', DE: 'XETR', F: 'FWB', SG: 'SWB', MU: 'MUN', DU: 'DUS', HM: 'HAM', BE: 'BER', HA: 'HAN',
  AS: 'EURONEXT', PA: 'EURONEXT', BR: 'EURONEXT', LS: 'EURONEXT', MI: 'MIL', L: 'LSE', SW: 'SIX',
  ST: 'OMXSTO', CO: 'OMXCOP', HE: 'OMXHEX', OL: 'OSL', VI: 'VIE', WA: 'GPW',
  TO: 'TSX', V: 'TSXV', AX: 'ASX', HK: 'HKEX', T: 'TSE',
};
/** Bolsa de FT Markets → bolsa de TradingView. */
const FT: Record<string, string> = {
  GER: 'XETR', FRA: 'FWB', LSE: 'LSE', NSQ: 'NASDAQ', NMQ: 'NASDAQ', NYQ: 'NYSE', ASE: 'AMEX', PCQ: 'AMEX',
  MIL: 'MIL', PAR: 'EURONEXT', AEX: 'EURONEXT', BRU: 'EURONEXT', LIS: 'EURONEXT', MCE: 'BME', SWX: 'SIX',
  STO: 'OMXSTO', CPH: 'OMXCOP', HEL: 'OMXHEX', OSL: 'OSL', VIE: 'VIE', TOR: 'TSX', ASX: 'ASX', HKG: 'HKEX', TYO: 'TSE',
};
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * Símbolo de TradingView de un valor, o null si TradingView no lo tiene: los fondos que solo se identifican
 * por ISIN o por código de Morningstar no cotizan en bolsa, y los índices y futuros de Yahoo se llaman distinto.
 */
export function tradingViewSymbol(symbol: string, quoteType?: string | null): string | null {
  const s = symbol.trim().toUpperCase();
  if (!s || ISIN.test(s) || /^0P[A-Z0-9]{8}(\.F)?$/.test(s) || /^\^|=F$/.test(s)) return null;
  if (s.includes(':')) {
    const [source, code, exchange] = s.split(':');
    if (source !== 'FT' || !code || ISIN.test(code) || !exchange) return null;
    const market = FT[exchange];
    return market ? `${market}:${code.replace(/\./g, '_')}` : null;
  }
  const fx = /^([A-Z]{6})=X$/.exec(s);
  if (fx) return `FX_IDC:${fx[1]}`;
  if (quoteType?.toUpperCase() === 'CRYPTOCURRENCY') return s.replace('-', '');
  if (quoteType?.toUpperCase() === 'MUTUALFUND') return null;
  const dot = s.lastIndexOf('.');
  if (dot > 0) {
    const market = YAHOO[s.slice(dot + 1)];
    return market ? `${market}:${s.slice(0, dot).replace(/-/g, '.')}` : null;
  }
  // Sin sufijo es un valor de EE. UU.: TradingView encuentra solo su bolsa. Las clases van con punto (BRK.B).
  return /^[A-Z0-9]+(-[A-Z])?$/.test(s) ? s.replace('-', '.') : null;
}
