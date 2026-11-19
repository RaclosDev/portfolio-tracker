import { localToday, quoteSession, type Quote } from '@watchlist/shared';
import { shortDate } from '../lib/format.ts';

/** Avisa de que el precio es de un cierre anterior: así no se toma por el de hoy (fines de semana, festivos). */
export function QuoteAge({ quote, today = localToday() }: { quote: Quote | null | undefined; today?: string }) {
  if (!quote?.priceTime) return null;
  const session = quoteSession(quote);
  if (!session || session >= today) return null;
  return (
    <span className="sub muted" title={`Último precio: ${new Date(quote.priceTime).toLocaleString('es-ES')}. La variación es la de esa sesión.`}>
      cierre {shortDate(session)}
    </span>
  );
}

/** true si alguna cotización es de la sesión de hoy (o no dice de cuándo es). */
export const anyQuoteToday = (quotes: (Quote | null | undefined)[], today = localToday()) =>
  quotes.some((q) => q?.price != null && (quoteSession(q) ?? today) >= today);
