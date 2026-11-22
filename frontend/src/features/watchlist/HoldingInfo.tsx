import { averageNativePrice, type HoldingRow } from '@/shared';
import { money, pct, price, qty } from '../../lib/format.ts';
import { HoverInfo } from './NoteCell.tsx';

/** Lo que tienes de un valor de Vigilar en la cartera: icono con el resumen al pasar el ratón. */
export function HoldingInfo({ h }: { h: HoldingRow }) {
  const avg = averageNativePrice(h.ledger, h.currency, h.fxRate);
  const brokers = Object.entries(h.ledger.sharesByBroker).filter(([, n]) => n > 1e-9);
  const tone = h.unrealizedEur == null || Math.abs(h.unrealizedEur) < 0.005 ? '' : h.unrealizedEur > 0 ? 'up' : 'down';
  return (
    <HoverInfo
      icon="wallet"
      label="En cartera: ver la posición"
      className="note-btn holding-btn"
      popClassName="holding-pop"
      inline={`En cartera: ${qty(h.ledger.shares)} acciones${avg != null ? ` a ${price(avg, h.currency)}` : ''} · ${money(h.valueEur ?? h.ledger.costEur, 'EUR', 2)}`}
    >
      <strong className="holding-pop__title">En cartera</strong>
      <dl className="holding-pop__list">
        <dt>Acciones</dt>
        <dd className="num">{qty(h.ledger.shares)}</dd>
        <dt>Precio medio</dt>
        <dd className="num">{avg != null ? price(avg, h.currency) : '–'}</dd>
        <dt>Coste</dt>
        <dd className="num">{money(h.ledger.costEur, 'EUR', 2)}</dd>
        <dt>Valor actual</dt>
        <dd className="num">{money(h.valueEur, 'EUR', 2)}</dd>
        <dt>Resultado</dt>
        <dd className={`num delta ${tone}`}>
          {money(h.unrealizedEur, 'EUR', 2)}
          {h.unrealizedPct != null && ` (${pct(h.unrealizedPct)})`}
        </dd>
      </dl>
      {brokers.length > 1 && <p className="holding-pop__sub">{brokers.map(([b, n]) => `${b} ${qty(n)}`).join(' · ')}</p>}
    </HoverInfo>
  );
}

/** Busca la posición de un valor de Vigilar: por ISIN si lo hay, si no por símbolo de cotización. */
export function holdingFinder(open: HoldingRow[]) {
  const bySymbol = new Map<string, HoldingRow>();
  const byIsin = new Map<string, HoldingRow>();
  for (const h of open) {
    if (h.instrument?.symbol) bySymbol.set(h.instrument.symbol.toUpperCase(), h);
    if (h.instrument?.isin) byIsin.set(h.instrument.isin.toUpperCase(), h);
  }
  return (symbol: string, isin: string | null | undefined) =>
    (isin && byIsin.get(isin.toUpperCase())) || bySymbol.get(symbol.toUpperCase());
}
