import type { ClosedRow, HoldingRow } from '@watchlist/shared';
import { useSparklines1y } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { MINOR_CURRENCY, money, num, pct, price, shortDate } from '../../lib/format.ts';
import { Sparkline } from '../watchlist/Sparkline.tsx';
import { signed, type CarteraModel } from './model.ts';
import { DataBar, SortTable, type Column } from './SortTable.tsx';

const Delta = ({ v, sub }: { v: number | null | undefined; sub?: number | null }) => (
  <div className="stack stack--right">
    <span className={`num delta ${signed(v)}`}>{money(v)}</span>
    {sub !== undefined && <span className={`sub num delta ${signed(sub)}`}>{pct(sub)}</span>}
  </div>
);

function NameCell({ r }: { r: HoldingRow | ClosedRow }) {
  return (
    <div className="stack">
      <span className="name">{r.name}</span>
      <span className="sub">
        <span className="ticker">{r.ticker}</span>
        {r.currency !== 'EUR' && (
          <span className="badge badge--fx" title={MINOR_CURRENCY[r.currency]}>
            {r.currency}
          </span>
        )}
        {r.sector && <span className="muted">{r.sector}</span>}
      </span>
    </div>
  );
}

/** «En cartera»: lo que tienes hoy, cuánto vale y cuánto llevas ganado con cada valor. */
export function HoldingsView({ model, onOpen }: { model: CarteraModel; onOpen: (ticker: string) => void }) {
  const { open, summary: s } = model.valuation;
  const symbols = open.map((r) => r.instrument?.symbol).filter((x): x is string => !!x);
  const sparks = useSparklines1y(symbols);
  const maxValue = Math.max(0, ...open.map((r) => r.valueEur ?? 0));
  const maxHist = Math.max(0, ...open.map((r) => Math.abs(r.historicEur ?? 0)));

  const columns: Column<HoldingRow>[] = [
    { id: 'name', label: 'Valor', sort: (r) => r.name.toLowerCase(), cell: (r) => <NameCell r={r} />, total: `Total · ${open.length} valores` },
    {
      id: 'shares',
      label: 'Acciones',
      align: 'right',
      sort: (r) => r.ledger.shares,
      cell: (r) => (
        <div className="stack stack--right">
          <span className="num">{num(r.ledger.shares, Number.isInteger(r.ledger.shares) ? 0 : 3)}</span>
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
          <span className="num">
            {price(r.price)}
            {r.quote?.stale && (
              <span className="stale" title="Sin conexión: último precio guardado">
                <Icon name="alert" />
              </span>
            )}
          </span>
          <span className={`sub num delta ${signed(r.changePct)}`}>{pct(r.changePct, 2)}</span>
        </div>
      ),
    },
    {
      id: 'spark',
      label: '1 año',
      cell: (r) => (r.instrument?.symbol ? <Sparkline closes={sparks.data?.[r.instrument.symbol]} period="12 meses" /> : <span className="muted">–</span>),
    },
    {
      id: 'value',
      label: 'Valor',
      align: 'right',
      title: 'Valor de mercado en euros',
      sort: (r) => r.valueEur,
      cell: (r) => (
        <DataBar value={r.valueEur} max={maxValue}>
          <span className="num">{money(r.valueEur)}</span>
        </DataBar>
      ),
      total: <span className="num">{money(s.valueEur)}</span>,
    },
    {
      id: 'cost',
      label: 'Coste',
      align: 'right',
      title: 'Lo que costaron las acciones que quedan (FIFO, con comisiones)',
      sort: (r) => r.ledger.costEur,
      cell: (r) => <span className="num">{money(r.ledger.costEur)}</span>,
      total: <span className="num">{money(s.costEur)}</span>,
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
      label: 'Hoy',
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
      cell: (r) => (
        <div className="stack stack--right">
          <span className={`num delta ${signed(r.ledger.realizedEur)}`}>{money(r.ledger.realizedEur)}</span>
          <span className="sub num">{money(r.ledger.dividendsEur + r.ledger.otherIncomeEur)} cobros</span>
        </div>
      ),
    },
    {
      id: 'historic',
      label: 'Total histórico',
      align: 'right',
      title: 'Todo lo ganado con este valor desde la primera compra: latente + ventas + cobros',
      sort: (r) => r.historicEur,
      cell: (r) => (
        <DataBar value={r.historicEur} max={maxHist}>
          <span className={`num delta ${signed(r.historicEur)}`}>{money(r.historicEur)}</span>
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
      onRowClick={(r) => onOpen(r.ticker)}
    />
  );
}

/** «Cerradas»: valores que ya no tienes, con lo que ganaste o perdiste en total. */
export function ClosedView({ model, onOpen }: { model: CarteraModel; onOpen: (ticker: string) => void }) {
  const { closed } = model.valuation;
  const max = Math.max(0, ...closed.map((r) => Math.abs(r.totalEur)));
  const sum = (f: (r: ClosedRow) => number) => closed.reduce((s, r) => s + f(r), 0);
  const columns: Column<ClosedRow>[] = [
    { id: 'name', label: 'Valor', sort: (r) => r.name.toLowerCase(), cell: (r) => <NameCell r={r} />, total: `Total · ${closed.length} valores` },
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
      cell: (r) => <span className="num">{money(r.ledger.boughtEur)}</span>,
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
      cell: (r) => <span className="num">{money(r.ledger.dividendsEur + r.ledger.otherIncomeEur)}</span>,
      total: <span className="num">{money(sum((r) => r.ledger.dividendsEur + r.ledger.otherIncomeEur))}</span>,
    },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      sort: (r) => r.totalEur,
      cell: (r) => (
        <DataBar value={r.totalEur} max={max}>
          <span className={`num delta ${signed(r.totalEur)}`}>{money(r.totalEur)}</span>
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
      onRowClick={(r) => onOpen(r.ticker)}
    />
  );
}
