import { DEFAULT_TAG_NAMES, instrumentKind, type CarteraRowBase, type ClosedRow, type HoldingRow } from '@/shared';
import { CompanyLogo } from '../../components/CompanyLogo.tsx';
import type { ReactNode } from 'react';
import { useSettings, useSparklines1y } from '../../api/hooks.ts';
import type { TypeFilter } from '../watchlist/TagFilters.tsx';
import { Icon } from '../../components/Icon.tsx';
import { anyQuoteToday, QuoteAge } from '../../components/QuoteAge.tsx';
import { MINOR_CURRENCY, money, num, qty, pct, price, shortDate } from '../../lib/format.ts';
import { Sparkline } from '../watchlist/Sparkline.tsx';
import { signed, type CarteraModel } from './model.ts';
import { DataBar, SortTable, type Column } from './SortTable.tsx';

const Delta = ({ v, sub }: { v: number | null | undefined; sub?: number | null }) => (
  <div className="stack stack--right">
    <span className={`num delta ${signed(v)}`}>{money(v, 'EUR', 2)}</span>
    {sub !== undefined && <span className={`sub num delta ${signed(sub)}`}>{pct(sub)}</span>}
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

  const columns: Column<HoldingRow>[] = [
    { id: 'name', label: 'Valor', sort: (r) => r.name.toLowerCase(), cell: (r) => <NameCell r={r} onOpen={onOpen} onTag={onTag} />, total: `Total · ${open.length} valores` },
    {
      id: 'shares',
      label: 'Acciones',
      align: 'right',
      sort: (r) => r.ledger.shares,
      cell: (r) => (
        <div className="stack stack--right">
          <span className="num">{qty(r.ledger.shares)}</span>
          <span className="sub">
            {Object.entries(r.ledger.sharesByBroker)
              .filter(([, n]) => n > 1e-9)
              .map(([b, n]) => `${b} ${num(n, Number.isInteger(n) ? 0 : 2)}`)
              .join(' · ') || (r.ledger.cycleStart ? `desde ${shortDate(r.ledger.cycleStart)}` : '')}
          </span>
        </div>
      ),
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
      cell: (r) => (r.instrument?.symbol ? <Sparkline closes={sparks.data?.[r.instrument.symbol]} period="12 meses" currency={r.currency} /> : <span className="muted">–</span>),
    },
    {
      id: 'value',
      label: 'Valoración',
      align: 'right',
      title: 'Valor de mercado en euros',
      sort: (r) => r.valueEur,
      cell: (r) => (
        <DataBar value={r.valueEur} max={maxValue}>
          <span className="num">{money(r.valueEur, 'EUR', 2)}</span>
        </DataBar>
      ),
      total: <span className="num">{money(s.valueEur, 'EUR', 2)}</span>,
    },
    {
      id: 'cost',
      label: 'Coste',
      align: 'right',
      title: 'Lo que costaron las acciones que quedan (FIFO, con comisiones)',
      sort: (r) => r.ledger.costEur,
      cell: (r) => <span className="num">{money(r.ledger.costEur, 'EUR', 2)}</span>,
      total: <span className="num">{money(s.costEur, 'EUR', 2)}</span>,
    },
    {
      id: 'unrealized',
      label: 'Resultado',
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
      sort: (r) => r.dayChangeEur,
      cell: (r) => <Delta v={r.dayChangeEur} />,
      total: <Delta v={s.dayChangeEur} />,
    },
    {
      id: 'income',
      label: 'Ventas y cobros',
      align: 'right',
      title: 'Resultado de las ventas ya hechas y dividendos cobrados de este valor',
      sort: (r) => r.ledger.realizedEur + r.ledger.dividendsEur + r.ledger.otherIncomeEur,
      cell: (r) => {
        const income = r.ledger.dividendsEur + r.ledger.otherIncomeEur;
        // Sin ventas ni cobros, un guion: una columna llena de «0,00 €» tapa las filas que sí tienen.
        if (!r.ledger.realizedEur && !income) return <span className="muted">–</span>;
        return (
          <div className="stack stack--right">
            <span className={`num delta ${signed(r.ledger.realizedEur)}`}>{money(r.ledger.realizedEur, 'EUR', 2)}</span>
            {income !== 0 && <span className="sub num">{money(income, 'EUR', 2)} cobros</span>}
          </div>
        );
      },
    },
    {
      id: 'historic',
      label: 'Total histórico',
      align: 'right',
      title: 'Todo lo ganado con este valor desde la primera compra: latente + ventas + cobros',
      sort: (r) => r.historicEur,
      cell: (r) => (
        <DataBar value={r.historicEur} max={maxHist}>
          <span className={`num delta ${signed(r.historicEur)}`}>{money(r.historicEur, 'EUR', 2)}</span>
        </DataBar>
      ),
    },
    {
      id: 'weight',
      label: 'Peso',
      align: 'right',
      sort: (r) => r.weight,
      cell: (r) => <span className="num">{pct(r.weight, 1).replace('+', '')}</span>,
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
