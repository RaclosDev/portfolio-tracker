import { averageNativePrice, DEFAULT_TAG_NAMES, instrumentKind, type CarteraRowBase, type ClosedRow, type HoldingRow } from '@/shared';
import { CompanyLogo } from '../../components/CompanyLogo.tsx';
import type { ReactNode } from 'react';
import { useSettings, useSparklines1y } from '../../api/hooks.ts';
import type { TypeFilter } from '../watchlist/TagFilters.tsx';
import { Icon } from '../../components/Icon.tsx';
import { anyQuoteToday, QuoteAge } from '../../components/QuoteAge.tsx';
import { avgPrice, MINOR_CURRENCY, money, num, qty, pct, price, shortDate } from '../../lib/format.ts';
import { Sparkline } from '../watchlist/Sparkline.tsx';
import { signed, type CarteraModel } from './model.ts';
import { DataBar, SortTable, type Column } from './SortTable.tsx';

/** Importe con su porcentaje debajo; los dos con el color del importe (un +0,4 % no queda gris junto a +20 €). */
const Delta = ({ v, sub, note }: { v: number | null | undefined; sub?: number | null; note?: ReactNode }) => (
  <div className="stack stack--right">
    <span className={`num delta ${signed(v)}`}>{money(v, 'EUR', 2)}</span>
    {sub !== undefined && <span className={`sub num delta ${signed(v)}`}>{pct(sub)}</span>}
    {note}
  </div>
);

/** Etiqueta pulsable de una fila (divisa o tipo): filtra la tabla por ella, como en Vigilar. */
export type CarteraTag = { kind: 'currency'; value: string } | { kind: 'type'; value: TypeFilter };
type OnTag = (tag: CarteraTag) => void;

function Tag({ tag, className, title, label, onTag }: { tag: CarteraTag; className: string; title: string; label: string; onTag?: OnTag }) {
  if (!onTag) return <span className={`badge ${className}`} title={title}>{label}</span>;
  return (
    <button
      type="button"
      className={`badge badge--btn ${className}`}
      title={`${title}Pulsa para ver solo ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onTag(tag);
      }}
    >
      {label}
    </button>
  );
}

function NameCell({ r, onOpen, onTag }: { r: HoldingRow | ClosedRow; onOpen: (ticker: string) => void; onTag?: OnTag }) {
  const names = useSettings().data?.tagNames ?? DEFAULT_TAG_NAMES;
  const kind = instrumentKind(r.instrument ?? { ticker: r.ticker, name: r.name }, r.quote?.quoteType);
  const kindLabel = kind === 'ETF' ? names.etf : kind === 'EQUITY' ? names.equity : kind === 'FUND' ? 'Fondo' : null;
  return (
    <div className="with-logo">
    <CompanyLogo isin={r.instrument?.isin ?? r.quote?.isin} symbol={r.quote?.symbol} name={r.name} />
    <div className="stack">
      <button type="button" className="name name-btn" onClick={(event) => {
        event.stopPropagation();
        onOpen(r.ticker);
      }}>{r.name}</button>
      <span className="sub">
        <span className="ticker">{r.ticker}</span>
        {r.quote?.exchange && <> · {r.quote.exchange}</>}
        {/* Divisa y tipo en todas las filas, como en Vigilar; la divisa distinta del euro lleva color. */}
        <Tag
          tag={{ kind: 'currency', value: r.currency }}
          className={r.currency !== 'EUR' ? 'badge--fx' : ''}
          title={MINOR_CURRENCY[r.currency] ? `${MINOR_CURRENCY[r.currency]}. ` : ''}
          label={r.currency}
          onTag={onTag}
        />
        {kindLabel && (
          <Tag
            tag={{ kind: 'type', value: kind as TypeFilter }}
            className={kind === 'ETF' ? 'badge--etf' : kind === 'EQUITY' ? 'badge--equity' : ''}
            title=""
            label={kindLabel}
            onTag={onTag}
          />
        )}
        {r.sector && <span className="muted">{r.sector}</span>}
      </span>
    </div>
    </div>
  );
}

/** «En cartera»: lo que tienes hoy, cuánto vale y cuánto llevas ganado con cada valor. */
export function HoldingsView({ model, onOpen, onTag, expanded }: { model: CarteraModel; onOpen: (ticker: string) => void; onTag?: OnTag; expanded?: (ticker: string, rows: CarteraRowBase[]) => ReactNode | null }) {
  const { open, summary: s } = model.valuation;
  const symbols = open.map((r) => r.instrument?.symbol).filter((x): x is string => !!x);
  const sparks = useSparklines1y(symbols);
  const maxValue = Math.max(0, ...open.map((r) => r.valueEur ?? 0));
  const maxHist = Math.max(0, ...open.map((r) => Math.abs(r.historicEur ?? 0)));
  const income = (r: HoldingRow) => r.ledger.dividendsEur + r.ledger.otherIncomeEur;
  // % del día sobre el valor de ayer (valor − variación), como el del resumen.
  const dayPct = (r: HoldingRow) => (r.dayChangeEur != null && r.valueEur != null && r.valueEur - r.dayChangeEur > 0 ? r.dayChangeEur / (r.valueEur - r.dayChangeEur) : null);
  // Total sobre todo lo invertido en el valor (también lo ya vendido): con ventas por medio, el coste de hoy no sirve de base.
  const histPct = (r: HoldingRow) => (r.historicEur != null && r.ledger.boughtEur > 0 ? r.historicEur / r.ledger.boughtEur : null);
  const priced = open.filter((r) => r.historicEur != null);
  const histSum = priced.reduce((t, r) => t + r.historicEur!, 0);
  const boughtSum = priced.reduce((t, r) => t + r.ledger.boughtEur, 0);
  const incomeSum = open.reduce((t, r) => t + income(r), 0);
  const cobros = (v: number) => (v ? <span className="sub num">{money(v, 'EUR', 2)} cobros</span> : null);

  const columns: Column<HoldingRow>[] = [
    { id: 'name', label: 'Valor', sort: (r) => r.name.toLowerCase(), cell: (r) => <NameCell r={r} onOpen={onOpen} onTag={onTag} />, total: `Total · ${open.length} valores` },
    {
      id: 'shares',
      label: 'Posición',
      align: 'right',
      title: 'Acciones que tienes y precio medio de compra (con comisiones, al cambio de cada compra)',
      sort: (r) => r.ledger.shares,
      cell: (r) => {
        const avg = averageNativePrice(r.ledger, r.currency, r.fxRate);
        const brokers = Object.entries(r.ledger.sharesByBroker).filter(([, n]) => n > 1e-9);
        return (
          <div className="stack stack--right">
            <span className="num">{qty(r.ledger.shares)}</span>
            {avg != null && <span className="sub num" title="Precio medio de compra">medio {avgPrice(avg, r.currency)}</span>}
            {/* El reparto por bróker solo dice algo si hay más de uno; con uno, desde cuándo tienes la posición. */}
            {brokers.length > 1
              ? <span className="sub">{brokers.map(([b, n]) => `${b} ${num(n, Number.isInteger(n) ? 0 : 2)}`).join(' · ')}</span>
              : r.ledger.cycleStart && <span className="sub" title={brokers[0] ? `En ${brokers[0][0]}` : undefined}>desde {shortDate(r.ledger.cycleStart)}</span>}
          </div>
        );
      },
    },
    {
      id: 'price',
      label: 'Precio',
      align: 'right',
      title: 'Precio actual y variación del día',
      sort: (r) => r.changePct,
      cell: (r) => (
        <div className="stack stack--right">
          <span className="num" title={r.quote?.source}>
            {price(r.price, r.currency)}
            {r.quote?.stale && (
              <span className="stale" title="Sin conexión: último precio guardado">
                <Icon name="alert" />
              </span>
            )}
          </span>
          {r.price == null ? <button type="button" className="link sub" onClick={(event) => {
            event.stopPropagation();
            onOpen(r.ticker);
          }}>{r.instrument?.symbol ? 'Revisar cotización' : 'Vincular cotización'}</button>
            : <span className={`sub num delta ${signed(r.changePct)}`}>{pct(r.changePct, 2)}</span>}
          {!r.quote?.asOf && <QuoteAge quote={r.quote} />}
          {r.quote?.asOf && <span className="sub" title={`Valor liquidativo · ${r.quote.source ?? ''}`}>VL {shortDate(r.quote.asOf)}</span>}
        </div>
      ),
    },
    {
      id: 'spark',
      label: '1 año',
      title: 'Cotización de los últimos 12 meses; la línea discontinua es tu precio medio de compra',
      cell: (r) => (r.instrument?.symbol
        ? <Sparkline closes={sparks.data?.[r.instrument.symbol]} cost={averageNativePrice(r.ledger, r.currency, r.fxRate)} period="12 meses" currency={r.currency} />
        : <span className="muted">–</span>),
    },
    {
      id: 'value',
      label: 'Valoración',
      align: 'right',
      title: 'Valor de mercado en euros, lo que costaron las acciones que quedan (FIFO, con comisiones) y su peso en la cartera',
      sort: (r) => r.valueEur,
      cell: (r) => (
        <DataBar value={r.valueEur} max={maxValue}>
          <div className="stack stack--right">
            <span className="num">{money(r.valueEur, 'EUR', 2)}</span>
            <span className="sub num">
              {/* En móvil no cabe el coste: queda el peso. */}
              <span className="value-cost">coste {money(r.ledger.costEur, 'EUR', 2)}{r.weight != null && ' · '}</span>
              {r.weight != null && <span title="Peso en la cartera">{pct(r.weight, 1).replace('+', '')}</span>}
            </span>
          </div>
        </DataBar>
      ),
      total: (
        <div className="stack stack--right">
          <span className="num">{money(s.valueEur, 'EUR', 2)}</span>
          <span className="sub num">coste {money(s.costEur, 'EUR', 2)}</span>
        </div>
      ),
    },
    {
      id: 'unrealized',
      label: 'Latente',
      align: 'right',
      title: 'Plusvalía si vendieras hoy: valor − coste',
      sort: (r) => r.unrealizedPct,
      cell: (r) => <Delta v={r.unrealizedEur} sub={r.unrealizedPct} />,
      total: <Delta v={s.unrealizedEur} sub={s.costEur ? s.unrealizedEur / s.costEur : null} />,
    },
    {
      id: 'day',
      label: anyQuoteToday(open.map((r) => r.quote)) ? 'Hoy' : 'Última sesión',
      align: 'right',
      title: 'Lo que ha ganado o perdido la posición en la sesión, en euros (con el cambio de divisa)',
      sort: (r) => r.dayChangeEur,
      cell: (r) => <Delta v={r.dayChangeEur} sub={dayPct(r)} />,
      total: <Delta v={s.dayChangeEur} sub={s.dayChangePct} />,
    },
    {
      id: 'historic',
      label: 'Total',
      align: 'right',
      title: 'Todo lo ganado con este valor desde la primera compra (latente + ventas + cobros) y su % sobre todo lo invertido en él',
      sort: (r) => r.historicEur,
      cell: (r) => {
        const inc = income(r);
        const sinceOpen = r.ledger.incomeSinceOpenEur;
        const detail = [
          `Latente ${money(r.unrealizedEur, 'EUR', 2)}`,
          `Ventas ${money(r.ledger.realizedEur, 'EUR', 2)}`,
          `Cobros ${money(inc, 'EUR', 2)}`,
          ...(sinceOpen > 0 && r.ledger.costEur > 0 && r.ledger.cycleStart
            ? [`Cobros desde ${shortDate(r.ledger.cycleStart)}: ${pct(sinceOpen / r.ledger.costEur, 1).replace('+', '')} sobre el coste`]
            : []),
        ].join('\n');
        return (
          <span title={detail}>
            <DataBar value={r.historicEur} max={maxHist}>
              <Delta v={r.historicEur} sub={histPct(r)} note={cobros(inc)} />
            </DataBar>
          </span>
        );
      },
      total: <Delta v={histSum} sub={boughtSum ? histSum / boughtSum : null} note={cobros(incomeSum)} />,
    },
  ];

  if (!open.length) return <p className="empty">No tienes ningún valor en cartera ahora mismo.</p>;
  return (
    <SortTable
      rows={open}
      columns={columns}
      rowKey={(r) => r.ticker}
      storageKey="watchlist.cartera.orden.abiertas"
      defaultSort={{ id: 'value', dir: 'desc' }}
      className="cartera-compact cartera-open"
      onRowClick={(r) => onOpen(r.ticker)}
      expanded={expanded && ((r, rows) => expanded(r.ticker, rows))}
    />
  );
}

/** «Cerradas»: valores que ya no tienes, con lo que ganaste o perdiste en total. */
export function ClosedView({ model, onOpen, onTag, expanded }: { model: CarteraModel; onOpen: (ticker: string) => void; onTag?: OnTag; expanded?: (ticker: string, rows: CarteraRowBase[]) => ReactNode | null }) {
  const { closed } = model.valuation;
  const max = Math.max(0, ...closed.map((r) => Math.abs(r.totalEur)));
  const sum = (f: (r: ClosedRow) => number) => closed.reduce((s, r) => s + f(r), 0);
  const columns: Column<ClosedRow>[] = [
    { id: 'name', label: 'Valor', sort: (r) => r.name.toLowerCase(), cell: (r) => <NameCell r={r} onOpen={onOpen} onTag={onTag} />, total: `Total · ${closed.length} valores` },
    {
      id: 'dates',
      label: 'Periodo',
      sort: (r) => r.ledger.lastDate,
      cell: (r) => (
        <span className="num">
          {shortDate(r.ledger.firstDate)} – {shortDate(r.ledger.lastDate)}
        </span>
      ),
    },
    {
      id: 'bought',
      label: 'Invertido',
      align: 'right',
      sort: (r) => r.ledger.boughtEur,
      cell: (r) => <span className="num">{money(r.ledger.boughtEur, 'EUR', 2)}</span>,
    },
    {
      id: 'realized',
      label: 'Ventas',
      align: 'right',
      title: 'Resultado de las ventas (precio de venta − coste FIFO)',
      sort: (r) => r.ledger.realizedEur,
      cell: (r) => <Delta v={r.ledger.realizedEur} sub={r.ledger.boughtEur ? r.ledger.realizedEur / r.ledger.boughtEur : null} />,
      total: <Delta v={sum((r) => r.ledger.realizedEur)} />,
    },
    {
      id: 'income',
      label: 'Cobros',
      align: 'right',
      sort: (r) => r.ledger.dividendsEur + r.ledger.otherIncomeEur,
      cell: (r) => <span className="num">{money(r.ledger.dividendsEur + r.ledger.otherIncomeEur, 'EUR', 2)}</span>,
      total: <span className="num">{money(sum((r) => r.ledger.dividendsEur + r.ledger.otherIncomeEur), 'EUR', 2)}</span>,
    },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      sort: (r) => r.totalEur,
      cell: (r) => (
        <DataBar value={r.totalEur} max={max}>
          <span className={`num delta ${signed(r.totalEur)}`}>{money(r.totalEur, 'EUR', 2)}</span>
        </DataBar>
      ),
      total: <Delta v={sum((r) => r.totalEur)} />,
    },
  ];
  if (!closed.length) return <p className="empty">Todavía no has cerrado ninguna posición.</p>;
  return (
    <SortTable
      rows={closed}
      columns={columns}
      rowKey={(r) => r.ticker}
      storageKey="watchlist.cartera.orden.cerradas"
      defaultSort={{ id: 'total', dir: 'desc' }}
      className="cartera-compact cartera-closed"
      onRowClick={(r) => onOpen(r.ticker)}
      expanded={expanded && ((r, rows) => expanded(r.ticker, rows))}
    />
  );
}
