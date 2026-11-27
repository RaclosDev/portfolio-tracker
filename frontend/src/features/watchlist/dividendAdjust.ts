import type { Candle } from '@/shared';

export interface Dividend {
  /** Fecha ex (AAAA-MM-DD, en el día de la bolsa). */
  date: string;
  amount: number;
}

/**
 * Ajusta las velas por dividendos hacia atrás, como hacen Yahoo y TradingView: cada vela anterior a una fecha
 * ex se multiplica por 1 − dividendo / cierre de la víspera, y los factores se van acumulando. Lo último no
 * cambia, así que las líneas de compra, órdenes y objetivos siguen en su sitio. Vale también para intradía:
 * se compara solo el día de la vela.
 */
export function adjustForDividends(bars: Candle[], dividends: Dividend[]): Candle[] {
  if (!bars.length || !dividends.length) return bars;
  // Un dividendo anunciado con fecha ex aún por llegar no ajusta nada todavía.
  const last = bars[bars.length - 1]!.t.slice(0, 10);
  const divs = dividends.filter((v) => v.date <= last).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = bars.slice();
  let factor = 1;
  let d = divs.length - 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    const day = bars[i]!.t.slice(0, 10);
    // Esta vela es la víspera de cada fecha ex posterior a su día que aún no se ha aplicado.
    while (d >= 0 && day < divs[d]!.date) {
      // Dividendo y cierre sin ajustar: los dos en la misma escala.
      const close = bars[i]!.c;
      const f = close > 0 ? 1 - divs[d]!.amount / close : 1;
      if (f > 0 && f < 1) factor *= f;
      d--;
    }
    if (factor !== 1) {
      const b = bars[i]!;
      out[i] = { ...b, o: b.o * factor, h: b.h * factor, l: b.l * factor, c: b.c * factor };
    }
  }
  return out;
}
