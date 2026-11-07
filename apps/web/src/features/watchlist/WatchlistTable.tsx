import { MAX_BUY_LEVELS, type LevelView, type WatchlistRow } from '@watchlist/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { MINOR_CURRENCY, money, num, pct, price, RECOMMENDATION_ES, shortDate } from '../../lib/format.ts';
import { PriceMap } from './PriceMap.tsx';

type SortDir = 'asc' | 'desc';
interface Column {
  id: string;
  label: string;
  title?: string;
  align?: 'right' | 'center';
  sort?: (r: WatchlistRow) => number | string | null;
  cell: (r: WatchlistRow, base: string) => ReactNode;
}

const STATUS_LABEL = { reached: 'En zona', near: 'Cerca', far: 'Lejos', unknown: '' } as const;

function LevelCell({ level }: { level: LevelView | undefined }) {
  if (!level) return <span className="muted">—</span>;
  return (
    <div className="stack stack--right">
      <span className="num">{price(level.price)}</span>
      <span className={`pill pill--${level.status}`} title={STATUS_LABEL[level.status]}>
        {level.status === 'reached' ? '✓ ' : ''}
        {pct(level.distancePct)}
      </span>
    </div>
  );
}

function Upside({ value }: { value: number | null }) {
  if (value == null) return null;
  return <span className={`delta ${value >= 0 ? 'up' : 'down'}`}>{pct(value, 0)}</span>;
}

const columns: Column[] = [
  {
    id: 'name',
    label: 'Valor',
    sort: (r) => (r.item.name ?? r.item.symbol).toLowerCase(),
    cell: ({ item, quote }, base) => (
      <div className="stack">
        <span className="name" title={item.name ?? undefined}>
          {item.name ?? item.symbol}
        </span>
        <span className="sub">
          <span className="ticker">{item.symbol}</span>
          {quote?.exchange && <> · {quote.exchange}</>}
          {quote?.currency && quote.currency !== base && (
            <span className="badge badge--fx" title={MINOR_CURRENCY[quote.currency]}>
              {quote.currency}
            </span>
          )}
          {quote?.quoteType === 'ETF' && <span className="badge">ETF</span>}
        </span>
      </div>
    ),
  },
  {
    id: 'price',
    label: 'Precio',
    align: 'right',
    sort: (r) => r.quote?.changePct ?? null,
    title: 'Ordena por variación del día',
    cell: ({ quote }) => (
      <div className="stack stack--right">
        <span className="num strong">
          {price(quote?.price)}
          {quote?.stale && (
            <span className="stale" title={`Dato guardado del ${new Date(quote.fetchedAt).toLocaleString('es-ES')}`}>
              ⚠
            </span>
          )}
        </span>
        {quote?.changePct != null && (
          <span className={`delta ${quote.changePct > 0 ? 'up' : quote.changePct < 0 ? 'down' : ''}`}>
            {pct(quote.changePct, 2)}
          </span>
        )}
      </div>
    ),
  },
  {
    id: 'map',
    label: 'Mapa de precios',
    sort: (r) => r.metrics.nearestDistancePct,
    title: 'Ordena por cercanía al nivel de compra más próximo',
    cell: (r) => <PriceMap row={r} />,
  },
  ...Array.from({ length: MAX_BUY_LEVELS }, (_, i): Column => ({
    id: `level${i}`,
    label: `Compra ${i + 1}`,
    align: 'right',
    sort: (r) => r.metrics.levels[i]?.distancePct ?? null,
    cell: (r) => <LevelCell level={r.metrics.levels[i]} />,
  })),
  {
    id: 'broker',
    label: 'Obj. bróker',
    align: 'right',
    sort: (r) => r.metrics.upsideBrokerPct,
    cell: ({ item, metrics }) =>
      item.brokerTarget == null ? (
        <span className="muted">—</span>
      ) : (
        <div className="stack stack--right">
          <span className="num">
            {price(item.brokerTarget)} <Upside value={metrics.upsideBrokerPct} />
          </span>
          {item.brokerName && <span className="sub">{item.brokerName}</span>}
        </div>
      ),
  },
  {
    id: 'consensus',
    label: 'Consenso',
    align: 'right',
    sort: (r) => r.metrics.upsideConsensusPct,
    cell: ({ targets, metrics }) =>
      targets?.mean == null ? (
        <span className="muted">—</span>
      ) : (
        <div
          className="stack stack--right"
          title={`Media ${price(targets.mean)} · mediana ${price(targets.median)} · rango ${price(targets.low)}–${price(targets.high)}`}
        >
          <span className="num">
            {price(targets.mean)} <Upside value={metrics.upsideConsensusPct} />
          </span>
          <span className="sub">
            {targets.analysts ?? '?'} analistas
            {targets.recommendation && targets.recommendation !== 'none' && ` · ${RECOMMENDATION_ES[targets.recommendation] ?? targets.recommendation}`}
          </span>
        </div>
      ),
  },
  {
    id: 'shares',
    label: 'Acciones',
    align: 'right',
    sort: (r) => r.metrics.shares,
    cell: ({ item, metrics }) => (
      <div className="stack stack--right">
        <span className="num">{num(metrics.shares)}</span>
        {metrics.sharesCalc != null && (
          <span className="sub" title={`Calculado: ${money(metrics.investAmount)} / precio de entrada`}>
            {item.sharesOverride != null ? `calc. ${num(metrics.sharesCalc, 1)}` : 'auto'}
          </span>
        )}
      </div>
    ),
  },
  {
    id: 'net',
    label: 'Importe',
    align: 'right',
    sort: (r) => r.metrics.netBase,
    title: 'Acciones × precio de entrada',
    cell: ({ metrics, quote }, base) => (
      <div className="stack stack--right">
        <span className="num">{money(metrics.netBase, base)}</span>
        {quote?.currency && quote.currency !== base && metrics.netNative != null && (
          <span className="sub">{money(metrics.netNative, quote.currency)}</span>
        )}
      </div>
    ),
  },
  {
    id: 'diff',
    label: 'Dif.',
    align: 'right',
    sort: (r) => r.metrics.diffBase,
    title: 'Acciones × (precio actual − precio de entrada), en divisa base',
    cell: ({ metrics }, base) => <span className="num">{money(metrics.diffBase, base)}</span>,
  },
  {
    id: 'order',
    label: 'Orden',
    sort: (r) => (r.item.orderActive ? (r.metrics.orderDaysLeft ?? 9999) : null),
    cell: ({ item, metrics }) =>
      item.orderActive ? (
        <div className="stack">
          <span className={`badge ${metrics.orderExpired ? 'badge--danger' : 'badge--order'}`}>
            {metrics.orderExpired ? 'Caducada' : 'Activa'} {item.orderPrice != null && `@ ${price(item.orderPrice)}`}
          </span>
          {item.orderUntil && (
            <span className="sub">
              hasta {shortDate(item.orderUntil)}
              {metrics.orderDaysLeft != null && metrics.orderDaysLeft >= 0 && ` · ${metrics.orderDaysLeft} d`}
            </span>
          )}
        </div>
      ) : null,
  },
  {
    id: 'notes',
    label: 'Notas',
    cell: ({ item }) =>
      item.notes ? (
        <span className="notes" title={item.notes}>
          {item.notes}
        </span>
      ) : null,
  },
];

function compare(a: number | string | null, b: number | string | null, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // vacíos siempre al final
  if (b == null) return -1;
  const r = typeof a === 'string' ? a.localeCompare(String(b), 'es') : a - (b as number);
  return dir === 'asc' ? r : -r;
}

interface Props {
  rows: WatchlistRow[];
  baseCurrency: string;
  onEdit: (row: WatchlistRow) => void;
}

export function WatchlistTable({ rows, baseCurrency, onEdit }: Props) {
  // Por defecto: lo más cercano a un nivel de compra arriba.
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>({ id: 'map', dir: 'desc' });

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => compare(col.sort!(a), col.sort!(b), sort.dir));
  }, [rows, sort]);

  const toggle = (id: string) =>
    setSort((s) => (s.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: id === 'name' ? 'asc' : 'desc' }));

  return (
    <div className="table-wrap">
      <table className="wl-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`}
                aria-sort={sort.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sort ? (
                  <button type="button" className="th-btn" onClick={() => toggle(c.id)} title={c.title}>
                    {c.label}
                    <span className="sort-ind" aria-hidden>
                      {sort.id === c.id ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
            <th className="col-actions">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.item.id}
              className={`row row--${r.metrics.status}${r.item.orderActive ? ' row--order' : ''}`}
              onDoubleClick={() => onEdit(r)}
            >
              {columns.map((c) => (
                <td key={c.id} className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`}>
                  {c.cell(r, baseCurrency)}
                </td>
              ))}
              <td className="col-actions">
                <button type="button" className="icon-btn" onClick={() => onEdit(r)} aria-label={`Editar ${r.item.symbol}`}>
                  ✎
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
