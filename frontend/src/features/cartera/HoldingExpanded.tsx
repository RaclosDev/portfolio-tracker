import { OPERATION_LABELS, instrumentKind, tradingViewSymbol, xirr, type Operation, type TickerLedger } from '@/shared';
import { CompanyLogo } from '../../components/CompanyLogo.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { avgPrice, money, num, pct, price, qty, share, shortDate } from '../../lib/format.ts';
import { tabListKeys } from '../../lib/tabs.ts';
import { useSize } from '../../lib/useSize.ts';
import { CandleChart } from '../watchlist/LazyCandleChart.tsx';
import { signed, type CarteraModel } from './model.ts';
import { FundHoldings, InstrumentForm, LotsTable, OperationActions, OperationsTable, compositionSource, heldFor, useTicker } from './TickerParts.tsx';
import type { OperationDraft } from './OperationDialog.tsx';

type Tab = 'resumen' | 'lotes' | 'operaciones' | 'fondo' | 'datos';
const TAB_KEY = 'watchlist.cartera.detalle.pestana';
type Sub = 'posicion' | 'rentabilidad' | 'cobros' | 'historial' | 'valor';
const SUB_KEY = 'watchlist.cartera.detalle.resumen';

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

function Kpi({ label, children, tone, sub, title }: { label: string; children: ReactNode; tone?: string; sub?: ReactNode; title?: string }) {
  return (
    <div className="sheet-kpi" title={title}>
      <dt>{label}</dt>
      <dd>
        <span className={tone ? `num delta ${tone}` : 'num'}>{children}</span>
        {sub != null && <span className={`sheet-kpi__sub num${tone ? ` delta ${tone}` : ''}`}>{sub}</span>}
      </dd>
    </div>
  );
}

/** Importe y, debajo, su porcentaje. */
const withPct = (eur: number | null | undefined, ratio: number | null | undefined) => (
  <>
    {money(eur, 'EUR', 2)}
    {ratio != null && <span className="sheet__sub">{pct(ratio)}</span>}
  </>
);

type OpFilter = 'all' | 'buy' | 'sell' | 'income';
const BUY_TYPES = new Set<Operation['type']>(['buy', 'transfer_in', 'scrip']);
const SELL_TYPES = new Set<Operation['type']>(['sell', 'transfer_out']);

const DAY = 86_400_000;
const isoToday = () => new Date().toISOString().slice(0, 10);

/**
 * Cifras del valor sacadas de sus operaciones: compras, ventas, cobros, fiscalidad y TIR.
 * La TIR usa los importes de compras y ventas, los cobros netos y el valor de hoy; con traspasos no se calcula
 * (el dinero entra desde otro fondo y no hay una compra con la que empezar).
 */
function stats(t: TickerLedger, ops: Operation[], valueEur: number | null) {
  const today = isoToday();
  const buys = ops.filter((o) => o.type === 'buy');
  const sells = ops.filter((o) => o.type === 'sell');
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const lastYear = t.income.filter((i) => i.date >= yearAgo);
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const transfers = ops.some((o) => o.type === 'transfer_in' || o.type === 'transfer_out');
  const flows = [
    ...buys.map((o) => ({ date: o.date, amount: -o.amountEur })),
    ...sells.map((o) => ({ date: o.date, amount: o.amountEur })),
    ...t.income.map((i) => ({ date: i.date, amount: i.econEur })),
    ...(t.shares > 0 && valueEur ? [{ date: today, amount: valueEur }] : []),
  ];
  const first = flows.reduce((a, f) => (f.date < a ? f.date : a), today);
  const end = t.shares > 0 ? today : t.lastDate;
  const days = Math.round((Date.parse(end) - Date.parse(first)) / DAY);
  const rate = transfers || (t.shares > 0 && !valueEur) ? null : xirr(flows);
  const lastIncome = t.income.reduce<(typeof t.income)[number] | null>((a, i) => (!a || i.date > a.date ? i : a), null);
  return {
    buys: buys.length,
    sells: sells.length,
    proceedsEur: sum(t.sales, (x) => x.proceedsEur),
    taxGainEur: sum(t.sales, (x) => x.taxGainEur),
    computableEur: sum(t.sales, (x) => x.computableEur),
    deferredEur: sum(t.sales, (x) => x.deferredLossEur),
    grossIncomeEur: sum(t.income, (i) => i.grossEur),
    withholdingEsEur: sum(t.income, (i) => i.withholdingEs ?? 0),
    withholdingForeignEur: sum(t.income, (i) => i.withholdingForeign ?? 0),
    incomeFeesEur: sum(t.income, (i) => i.feesEur),
    // Comisiones de compras y ventas: vienen en la divisa del valor.
    feesEur: sum([...buys, ...sells], (o) => o.fees / (o.fxRate || 1)),
    lastYearIncomeEur: sum(lastYear, (i) => i.econEur),
    lastIncome,
    // Con menos de un año, la TIR anualizada exagera: se enseña lo ganado en el periodo, sin anualizar.
    tir: rate == null ? null : days >= 365 ? rate : (1 + rate) ** (Math.max(days, 1) / 365) - 1,
    tirAnnual: days >= 365,
  };
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
  const [opFilter, setOpFilter] = useState<OpFilter>('all');
  const [subChosen, setSub] = useState<Sub>(() => (localStorage.getItem(SUB_KEY) as Sub) || 'posicion');

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
  const sector = row?.sector ?? inst?.sector ?? null;
  const st = stats(t, ops, valueEur);
  const income = t.dividendsEur + t.otherIncomeEur;
  const totalEur = holding ? holding.historicEur : closedTotal;
  // Sobre todo lo invertido en el valor (también lo ya vendido), como el «Total» de la tabla.
  const totalPct = totalEur != null && t.boughtEur > 0 ? totalEur / t.boughtEur : null;
  const dayPct = holding?.dayChangeEur != null && holding.valueEur != null && holding.valueEur - holding.dayChangeEur > 0
    ? holding.dayChangeEur / (holding.valueEur - holding.dayChangeEur)
    : null;
  const dayLabel = 'Hoy';
  const vsAvg = last != null && avgNative ? last / avgNative - 1 : null;
  const brokers = Object.entries(t.sharesByBroker).filter(([, n]) => n > 1e-9);
  const tirKpi = (
    <Kpi
      label={st.tirAnnual ? 'TIR anual' : 'TIR'}
      tone={signed(st.tir)}
      sub={st.tir == null ? undefined : st.tirAnnual ? 'desde la 1.ª compra' : 'sin anualizar'}
      title="Rentabilidad del dinero metido según las fechas de compras, ventas y cobros (y el valor de hoy)"
    >
      {st.tir != null ? pct(st.tir, 1) : '–'}
    </Kpi>
  );
  const isIncome = (o: Operation) => t.income.some((i) => i.id === o.id);
  const opGroups = ([
    ['all', 'Todas', ops.length],
    ['buy', 'Compras', ops.filter((o) => BUY_TYPES.has(o.type)).length],
    ['sell', 'Ventas', ops.filter((o) => SELL_TYPES.has(o.type)).length],
    ['income', 'Cobros', ops.filter(isIncome).length],
  ] as [OpFilter, string, number][]).filter(([v, , n]) => v === 'all' || n > 0);
  const shownOps = opFilter === 'all' || !opGroups.some(([v]) => v === opFilter)
    ? ops
    : ops.filter((o) => (opFilter === 'buy' ? BUY_TYPES.has(o.type) : opFilter === 'sell' ? SELL_TYPES.has(o.type) : isIncome(o)));
  const marks = ops.filter((o) => o.type === 'buy' || o.type === 'sell').map((o) => ({ date: o.date, side: o.type === 'buy' ? ('buy' as const) : ('sell' as const) }));

  const subs = ([
    ['posicion', 'Posición', !!holding],
    ['rentabilidad', 'Rentabilidad', true],
    ['cobros', 'Cobros', t.income.length > 0],
    ['historial', 'Historial', true],
    ['valor', 'Valor', true],
  ] as [Sub, string, boolean][]).filter(([, , ok]) => ok);
  const sub = subs.some(([v]) => v === subChosen) ? subChosen : subs[0]![0];
  const chooseSub = (v: Sub) => {
    setSub(v);
    localStorage.setItem(SUB_KEY, v);
  };

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
          <CompanyLogo className="xp__logo" isin={inst?.isin ?? quote?.isin} symbol={quote?.symbol} name={name} size={36} />
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
                marks={marks}
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
                        <Kpi label="Valoración" sub={holding.weight != null ? `${share(holding.weight, 1)} cartera` : undefined}>
                          {money(holding.valueEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Latente" tone={signed(holding.unrealizedEur)} sub={pct(holding.unrealizedPct)} title="Si vendieras hoy: valor − coste">
                          {money(holding.unrealizedEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Total" tone={signed(totalEur)} sub={pct(totalPct)} title="Latente + ventas + cobros; % sobre todo lo invertido">
                          {money(totalEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label={dayLabel} tone={signed(holding.dayChangeEur)} sub={pct(dayPct, 2)}>
                          {money(holding.dayChangeEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Precio medio" tone={signed(vsAvg)} sub={vsAvg != null ? `${pct(vsAvg)} hoy` : undefined} title="Precio medio de compra y cuánto está por encima o por debajo el precio actual">
                          {avgNative ? avgPrice(avgNative, cur) : '–'}
                        </Kpi>
                        {tirKpi}
                      </>
                    ) : (
                      <>
                        <Kpi label="Resultado" tone={signed(closedTotal)} sub={pct(totalPct)} title="Ventas + cobros; % sobre todo lo invertido">
                          {money(closedTotal, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Ventas" tone={signed(t.realizedEur)} sub={`${st.sells} ${st.sells === 1 ? 'venta' : 'ventas'}`}>
                          {money(t.realizedEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Cobros" sub={t.income.length ? `${t.income.length} ${t.income.length === 1 ? 'cobro' : 'cobros'}` : undefined}>
                          {money(income, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Invertido" sub={`${st.buys} ${st.buys === 1 ? 'compra' : 'compras'}`}>
                          {money(t.boughtEur, 'EUR', 0)}
                        </Kpi>
                        <Kpi label="Recibido" title="Lo cobrado en las ventas, sin comisiones">
                          {money(st.proceedsEur, 'EUR', 0)}
                        </Kpi>
                        {tirKpi}
                      </>
                    )}
                  </dl>

                  <div className="segmented segmented--small xp-tab__filter sheet__nav" role="group" aria-label="Apartado del resumen">
                    {subs.map(([v, label]) => (
                      <button key={v} type="button" className={sub === v ? 'on' : ''} aria-pressed={sub === v} onClick={() => chooseSub(v)}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {sub === 'posicion' && holding && (
                    <section className="sheet__section">
                      <h3>Posición</h3>
                      <dl>
                        <Row label="Acciones">{qty(t.shares)}</Row>
                        {brokers.length > 1 && brokers.map(([b, n]) => (
                          <Row key={b} label={`· en ${b}`}>
                            {qty(n)}
                            <span className="sheet__sub">{share(n / t.shares, 0)}</span>
                          </Row>
                        ))}
                        {brokers.length === 1 && <Row label="Bróker">{brokers[0]![0]}</Row>}
                        <Row label="Precio actual">
                          {price(last, cur)}
                          {change != null && <span className={`sheet__sub delta ${signed(change)}`}>{pct(change, 2)} hoy</span>}
                        </Row>
                        <Row label="Precio medio">{avgNative ? avgPrice(avgNative, cur) : '–'}</Row>
                        <Row label="Valoración">{money(holding.valueEur, 'EUR', 2)}</Row>
                        <Row label="Coste">{money(t.costEur, 'EUR', 2)}</Row>
                        {Math.abs(t.taxCostEur - t.costEur) >= 0.5 && (
                          <Row label="Coste fiscal">
                            {money(t.taxCostEur, 'EUR', 2)}
                            <span className="sheet__sub">el que cuenta para Hacienda</span>
                          </Row>
                        )}
                        {holding.weight != null && <Row label="Peso en cartera">{share(holding.weight, 1)}</Row>}
                        <Row label="Lotes abiertos">{t.openLots.length}</Row>
                        {cur !== 'EUR' && fxRate != null && <Row label="Cambio">{`1 € = ${fxRate.toLocaleString('es-ES', { maximumFractionDigits: 4 })} ${cur}`}</Row>}
                      </dl>
                    </section>
                  )}

                  {sub === 'rentabilidad' && (
                    <section className="sheet__section">
                      <h3>Rentabilidad</h3>
                      <dl>
                        {holding && (
                          <>
                            <Row label="Latente" tone={signed(holding.unrealizedEur)}>
                              {withPct(holding.unrealizedEur, holding.unrealizedPct)}
                            </Row>
                            <Row label={dayLabel} tone={signed(holding.dayChangeEur)}>
                              {withPct(holding.dayChangeEur, dayPct)}
                            </Row>
                          </>
                        )}
                        {(t.sales.length > 0 || t.realizedEur !== 0) && (
                          <Row label="Ventas" tone={signed(t.realizedEur)}>
                            {money(t.realizedEur, 'EUR', 2)}
                          </Row>
                        )}
                        <Row label="Dividendos">{money(t.dividendsEur, 'EUR', 2)}</Row>
                        {t.otherIncomeEur !== 0 && <Row label="Otros cobros">{money(t.otherIncomeEur, 'EUR', 2)}</Row>}
                        <Row label={holding ? 'Total histórico' : 'Total'} tone={signed(totalEur)}>
                          {money(totalEur, 'EUR', 2)}
                          {totalPct != null && <span className="sheet__sub">{pct(totalPct)} sobre {money(t.boughtEur, 'EUR', 0)} invertidos</span>}
                        </Row>
                        {st.tir != null && (
                          <Row label={st.tirAnnual ? 'TIR anual' : 'TIR (sin anualizar)'} tone={signed(st.tir)}>
                            {pct(st.tir, 2)}
                          </Row>
                        )}
                      </dl>
                    </section>
                  )}

                  {sub === 'cobros' && t.income.length > 0 && (
                    <section className="sheet__section">
                      <h3>Cobros</h3>
                      <dl>
                        <Row label="Cobros">{t.income.length}</Row>
                        <Row label="Bruto">{money(st.grossIncomeEur, 'EUR', 2)}</Row>
                        {st.withholdingEsEur > 0 && (
                          <Row label="Retención en España">
                            {money(st.withholdingEsEur, 'EUR', 2)}
                            <span className="sheet__sub">se descuenta en la Renta</span>
                          </Row>
                        )}
                        {st.withholdingForeignEur > 0 && <Row label="Retención en origen">{money(-st.withholdingForeignEur, 'EUR', 2)}</Row>}
                        {st.incomeFeesEur > 0 && <Row label="Comisiones">{money(-st.incomeFeesEur, 'EUR', 2)}</Row>}
                        <Row label="Para la rentabilidad">
                          {money(income, 'EUR', 2)}
                          <span className="sheet__sub">sin comisiones ni retención en origen</span>
                        </Row>
                        <Row label="Últimos 12 meses">
                          {money(st.lastYearIncomeEur, 'EUR', 2)}
                          {holding?.valueEur && st.lastYearIncomeEur > 0 ? <span className="sheet__sub">{share(st.lastYearIncomeEur / holding.valueEur, 2)} sobre el valor</span> : null}
                        </Row>
                        {holding && t.incomeSinceOpenEur > 0 && t.costEur > 0 && t.cycleStart && (
                          <Row label={`Desde ${shortDate(t.cycleStart)}`}>
                            {money(t.incomeSinceOpenEur, 'EUR', 2)}
                            <span className="sheet__sub">{share(t.incomeSinceOpenEur / t.costEur, 1)} sobre el coste</span>
                          </Row>
                        )}
                        {st.lastIncome && (
                          <Row label="Último">
                            {money(st.lastIncome.econEur, 'EUR', 2)}
                            <span className="sheet__sub">{shortDate(st.lastIncome.date)} · {OPERATION_LABELS[st.lastIncome.type]}</span>
                          </Row>
                        )}
                      </dl>
                    </section>
                  )}

                  {sub === 'historial' && (
                    <section className="sheet__section">
                      <h3>Historial</h3>
                      <dl>
                        <Row label="Primera compra">
                          {shortDate(t.firstDate)}
                          <span className="sheet__sub">hace {heldFor(t.firstDate)}</span>
                        </Row>
                        {holding && t.cycleStart && t.cycleStart !== t.firstDate && (
                          <Row label="Posición actual desde">
                            {shortDate(t.cycleStart)}
                            <span className="sheet__sub">hace {heldFor(t.cycleStart)}</span>
                          </Row>
                        )}
                        <Row label="Última operación">{shortDate(t.lastDate)}</Row>
                        <Row label="Compras">
                          {st.buys}
                          <span className="sheet__sub">{money(t.boughtEur, 'EUR', 2)} invertidos</span>
                        </Row>
                        {st.sells > 0 && (
                          <Row label="Ventas">
                            {st.sells}
                            <span className="sheet__sub">
                              {qty(t.soldShares)} acciones · {money(st.proceedsEur, 'EUR', 2)}
                            </span>
                          </Row>
                        )}
                        {st.feesEur > 0 && <Row label="Comisiones">{money(st.feesEur, 'EUR', 2)}</Row>}
                        <Row label="Operaciones">{num(ops.length)}</Row>
                      </dl>
                    </section>
                  )}

                  {sub === 'rentabilidad' && t.sales.length > 0 && (
                    <section className="sheet__section">
                      <h3>Fiscal</h3>
                      <dl>
                        <Row label="Resultado fiscal" tone={signed(st.taxGainEur)}>
                          {money(st.taxGainEur, 'EUR', 2)}
                        </Row>
                        {st.deferredEur > 0 && (
                          <Row label="Pérdida aplazada">
                            {money(st.deferredEur, 'EUR', 2)}
                            <span className="sheet__sub">regla de recompra</span>
                          </Row>
                        )}
                        <Row label="A declarar" tone={signed(st.computableEur)}>
                          {money(st.computableEur, 'EUR', 2)}
                        </Row>
                      </dl>
                    </section>
                  )}

                  {sub === 'valor' && (
                    <section className="sheet__section">
                      <h3>Valor</h3>
                      <dl>
                        {(inst?.isin ?? t.isin) && <Row label="ISIN">{inst?.isin ?? t.isin}</Row>}
                        {symbol && <Row label="Cotización">{symbol}{quote?.exchange && <span className="sheet__sub">{quote.exchange}</span>}</Row>}
                        <Row label="Tipo">{kind === 'FUND' ? 'Fondo' : kind === 'ETF' ? 'ETF' : 'Acción'}</Row>
                        <Row label="Divisa">{cur}</Row>
                        {sector && <Row label="Sector">{sector}</Row>}
                        {t.members.length > 1 && <Row label="Agrupa">{t.members.join(' · ')}</Row>}
                      </dl>
                    </section>
                  )}

                  {sub === 'valor' && inst?.notes && (
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
                  <LotsTable t={t} cur={cur} fxRate={fxRate} valueEur={valueEur} compact={!wide} tiny={tiny} />
                </>
              )}
              {tab === 'operaciones' && (
                <>
                  <div className="xp-tab__actions">
                    <OperationActions ticker={ticker} t={t} lastBroker={lastBroker} onAdd={onAddOperation} />
                  </div>
                  {opGroups.length > 2 && (
                    <div className="segmented segmented--small xp-tab__filter" role="group" aria-label="Filtrar operaciones">
                      {opGroups.map(([v, label, n]) => (
                        <button key={v} type="button" className={opFilter === v ? 'on' : ''} aria-pressed={opFilter === v} onClick={() => setOpFilter(v)}>
                          {label}
                          <span className="count">{n}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <OperationsTable ops={shownOps} t={t} cur={cur} onEdit={onEditOperation} compact={!wide} tiny={tiny} />
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
