import { instrumentKind, tradingViewSymbol, type Operation } from '@/shared';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { money, pct, price, qty, share } from '../../lib/format.ts';
import { tabListKeys } from '../../lib/tabs.ts';
import { useSize } from '../../lib/useSize.ts';
import { CandleChart } from '../watchlist/CandleChart.tsx';
import { signed, type CarteraModel } from './model.ts';
import { FundHoldings, InstrumentForm, LotsTable, OperationActions, OperationsTable, compositionSource, useTicker } from './TickerParts.tsx';
import type { OperationDraft } from './OperationDialog.tsx';

type Tab = 'resumen' | 'lotes' | 'operaciones' | 'fondo' | 'datos';
const TAB_KEY = 'watchlist.cartera.detalle.pestana';

interface Props {
  model: CarteraModel;
  ticker: string;
  onClose: () => void;
  onEditOperation: (op: Operation) => void;
  onAddOperation: (draft: OperationDraft) => void;
  /** Carril con los demás valores de la tabla, como en Vigilar. */
  rail?: ReactNode;
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="sheet__row">
      <dt>{label}</dt>
      <dd className={tone ? `num delta ${tone}` : 'num'}>{children}</dd>
    </div>
  );
}

function Kpi({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="sheet-kpi">
      <dt>{label}</dt>
      <dd>
        <span className={tone ? `num delta ${tone}` : 'num'}>{children}</span>
      </dd>
    </div>
  );
}

/** Alto en escritorio: lo que queda de pantalla bajo la cabecera, como el detalle de Vigilar. */
function useFillScreen(box: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const header = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
      const row = el.closest('tr')?.previousElementSibling?.getBoundingClientRect().height ?? 0;
      el.style.setProperty('--xp-fill', `${Math.round(window.innerHeight - header - row)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [box]);
}

/** Al abrirlo, lo pega bajo la cabecera (en móvil, con la fila del valor encima). */
function useScrollIntoPlace(box: React.RefObject<HTMLDivElement | null>, ticker: string) {
  useEffect(() => {
    const tr = box.current?.closest('tr');
    if (!tr) return;
    const prev = tr.previousElementSibling as HTMLElement | null;
    const anchor = prev && prev.offsetHeight > 0 ? prev : tr;
    requestAnimationFrame(() => {
      const header = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const delta = anchor.getBoundingClientRect().top - Math.max(0, header);
      if (Math.abs(delta) < 2) return;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
    });
  }, [box, ticker]);
}

/**
 * Detalle de un valor de la cartera bajo su fila, con el mismo visor que Vigilar: velas a la izquierda
 * (con el coste medio marcado) y, a la derecha, el resumen, los lotes, las operaciones y sus datos.
 */
export function HoldingExpanded({ model, ticker, onClose, onEditOperation, onAddOperation, rail }: Props) {
  const d = useTicker(model, ticker);
  const { t, row, inst, composition, ops, cur, fxRate, lastBroker, valueEur, avgNative } = d;
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // Con sitio de sobra, las tablas llevan todas sus columnas (precio, bróker, coste fiscal).
  const [dataRef, dataSize] = useSize<HTMLElement>();
  const wide = dataSize.w >= 640;
  const tiny = dataSize.w > 0 && dataSize.w < 440;
  useFillScreen(box);
  useScrollIntoPlace(box, ticker);
  const [chosen, setTab] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) as Tab) || 'resumen');

  // Esc cierra, salvo que lo esté usando un campo o un diálogo abierto encima.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!t) return null;
  const name = row?.name ?? inst?.name ?? ticker;
  const quote = row?.quote ?? null;
  const symbol = inst?.symbol ?? null;
  const isFund = composition != null && composition.holdings.length > 0;
  const kind = instrumentKind(inst ?? { ticker, name }, quote?.quoteType);
  const holding = row && 'valueEur' in row ? row : null;
  const closedTotal = row && 'totalEur' in row ? row.totalEur : null;
  // Las cerradas no traen precio en la fila: se toma de la cotización.
  const last = row?.price ?? quote?.price ?? null;
  const change = row?.changePct ?? quote?.changePct ?? null;

  const tabs: [Tab, string][] = [
    ['resumen', 'Resumen'],
    ...(t.openLots.length ? [['lotes', `Lotes · ${t.openLots.length}`] as [Tab, string]] : []),
    ['operaciones', `Operaciones · ${ops.length}`],
    ...(isFund ? [['fondo', 'Qué lleva'] as [Tab, string]] : []),
    ['datos', 'Datos'],
  ];
  const tab = tabs.some(([v]) => v === chosen) ? chosen : 'resumen';
  const choose = (v: Tab) => {
    setTab(v);
    localStorage.setItem(TAB_KEY, v);
  };

  return (
    <div ref={box} className={`xp xp--cartera xp--active${rail ? ' xp--rail' : ''}`} role="region" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="sr-only">Detalle de {name}</h2>
      {rail}
      <div className="xp__main">
        <header className="xp__head">
          <div className="xp__id" aria-hidden>
            <span className="xp__name" title={name}>{name}</span>
            <span className="sub">
              <span className="ticker">{ticker}</span>
              {quote?.exchange && <> · {quote.exchange}</>}
              {cur && <> · {cur}</>}
              {kind === 'FUND' ? ' · Fondo' : kind === 'ETF' ? ' · ETF' : ''}
            </span>
          </div>
          <div className="xp__quote">
            <span className="xp__price num">{price(last, cur)}</span>
            {change != null && <span className={`delta ${change >= 0 ? 'up' : 'down'}`}>{pct(change, 2)} hoy</span>}
          </div>
          <p className="xp__status">
            {t.shares > 0 ? (
              <span className="muted">
                {qty(t.shares)} acciones{holding?.valueEur != null && <> · {money(holding.valueEur, 'EUR', 2)}</>}
              </span>
            ) : (
              <span className="pill">Cerrada</span>
            )}
          </p>
          <div className="xp__tools">
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar el detalle" title="Cerrar (Esc)">
              ×
            </button>
          </div>
        </header>

        <div className="xp__body">
          <section className="xp__panel xp__visual" aria-label="Gráfico">
            {symbol ? (
              <CandleChart
                key={symbol}
                symbol={symbol}
                name={name}
                price={last}
                lines={avgNative && t.shares > 0 ? [{ price: avgNative, title: 'Coste medio' }] : []}
                tvSymbol={tradingViewSymbol(symbol, quote?.quoteType)}
              />
            ) : (
              <p className="empty">
                Este valor no tiene símbolo de cotización, así que no hay gráfico.{' '}
                <button type="button" className="link-btn" onClick={() => choose('datos')}>
                  Añadir el símbolo
                </button>
              </p>
            )}
          </section>

          <section ref={dataRef} className="xp__panel xp__data" aria-label="Datos">
            <div className="xp__tabs" role="tablist" aria-label="Datos del valor" onKeyDown={tabListKeys}>
              {tabs.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${v}`}
                  aria-controls={`${id}-panel`}
                  aria-selected={tab === v}
                  tabIndex={tab === v ? 0 : -1}
                  className={tab === v ? 'on' : ''}
                  onClick={() => choose(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={`xp-tab${wide ? ' xp-tab--wide' : ''}`} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
              {tab === 'resumen' && (
                <div className="sheet">
                  <dl className="sheet-kpis">
                    {holding ? (
                      <>
                        <Kpi label="Acciones">{qty(t.shares)}</Kpi>
                        <Kpi label="Coste medio">{avgNative ? price(avgNative, cur) : '–'}</Kpi>
                        <Kpi label="Latente" tone={signed(holding.unrealizedEur)}>
                          {holding.unrealizedPct != null ? pct(holding.unrealizedPct) : '–'}
                        </Kpi>
                      </>
                    ) : (
                      <>
                        <Kpi label="Resultado" tone={signed(closedTotal)}>
                          {closedTotal != null ? money(closedTotal, 'EUR', 0) : '–'}
                        </Kpi>
                        <Kpi label="Ventas" tone={signed(t.realizedEur)}>
                          {money(t.realizedEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Cobros">{money(t.dividendsEur + t.otherIncomeEur, 'EUR', 0)}</Kpi>
                      </>
                    )}
                  </dl>
                  {holding && (
                    <section className="sheet__section">
                      <h3>Posición</h3>
                      <dl>
                        <Row label="Valor">{money(holding.valueEur, 'EUR', 2)}</Row>
                        <Row label="Coste">{money(t.costEur, 'EUR', 2)}</Row>
                        <Row label="Latente" tone={signed(holding.unrealizedEur)}>
                          {money(holding.unrealizedEur, 'EUR', 2)}
                        </Row>
                        <Row label="Hoy" tone={signed(holding.dayChangeEur)}>
                          {money(holding.dayChangeEur, 'EUR', 2)}
                        </Row>
                        {holding.weight != null && <Row label="Peso en cartera">{share(holding.weight, 1)}</Row>}
                        {cur !== 'EUR' && fxRate != null && <Row label="Cambio">{`1 € = ${fxRate.toLocaleString('es-ES', { maximumFractionDigits: 4 })} ${cur}`}</Row>}
                      </dl>
                    </section>
                  )}
                  <section className="sheet__section">
                    <h3>Lo ganado</h3>
                    <dl>
                      <Row label="Ventas" tone={signed(t.realizedEur)}>
                        {money(t.realizedEur, 'EUR', 2)}
                      </Row>
                      <Row label="Dividendos">{money(t.dividendsEur, 'EUR', 2)}</Row>
                      {t.otherIncomeEur !== 0 && <Row label="Otros cobros">{money(t.otherIncomeEur, 'EUR', 2)}</Row>}
                      {holding?.historicEur != null && (
                        <Row label="Total histórico" tone={signed(holding.historicEur)}>
                          {money(holding.historicEur, 'EUR', 2)}
                        </Row>
                      )}
                      {closedTotal != null && (
                        <Row label="Total" tone={signed(closedTotal)}>
                          {money(closedTotal, 'EUR', 2)}
                        </Row>
                      )}
                    </dl>
                  </section>
                  {inst?.notes && (
                    <section className="sheet__section sheet__notes">
                      <h3>Notas</h3>
                      <p>{inst.notes}</p>
                    </section>
                  )}
                </div>
              )}
              {tab === 'lotes' && (
                <>
                  <p className="xp-tab__note muted small">FIFO: al vender salen primero los lotes más antiguos.</p>
                  <LotsTable t={t} cur={cur} fxRate={fxRate} compact={!wide} tiny={tiny} />
                </>
              )}
              {tab === 'operaciones' && (
                <>
                  <div className="xp-tab__actions">
                    <OperationActions ticker={ticker} t={t} lastBroker={lastBroker} onAdd={onAddOperation} />
                  </div>
                  <OperationsTable ops={ops} t={t} cur={cur} onEdit={onEditOperation} compact={!wide} tiny={tiny} />
                </>
              )}
              {tab === 'fondo' && composition && (
                <>
                  <p className="xp-tab__note muted small">
                    {composition.holdings.length} posiciones · {compositionSource(composition)}
                  </p>
                  <FundHoldings composition={composition} valueEur={valueEur} />
                </>
              )}
              {tab === 'datos' && <InstrumentForm key={ticker} model={model} ticker={ticker} compact />}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
