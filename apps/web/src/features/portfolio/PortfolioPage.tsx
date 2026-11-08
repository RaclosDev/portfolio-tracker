import { isMuted, localToday, type PortfolioRow, type PortfolioView } from '@watchlist/shared';
import { TagName } from '../../components/TagName.tsx';
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { MINOR_CURRENCY, money, num, pct, price, shortDate } from '../../lib/format.ts';

type SortDir = 'asc' | 'desc';
const SORT_KEY = 'watchlist.cartera.orden';

interface Col {
  id: string;
  label: string;
  title?: string;
  align?: 'right';
  sort?: (r: PortfolioRow) => number | string | null;
  cell: (r: PortfolioRow, base: string) => ReactNode;
}

export const positionName = (r: PortfolioRow) => r.position.name ?? r.quote?.name ?? r.position.symbol;
const signed = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const unsigned = (v: number | null | undefined, digits = 1) => pct(v, digits).replace('+', '');

const SELL_LABEL = { reached: 'Alcanzado', near: 'Cerca', below: '', none: '' } as const;

const columns: Col[] = [
  {
    id: 'name',
    label: 'Valor',
    sort: (r) => positionName(r).toLowerCase(),
    cell: (r, base) => (
      <div className="stack">
        <span className="name">{positionName(r)}</span>
        <span className="sub">
          <span className="ticker">{r.position.symbol}</span>
          {r.quote?.currency && (
            <span className={`badge${r.quote.currency !== base ? ' badge--fx' : ''}`} title={MINOR_CURRENCY[r.quote.currency]}>
              {r.quote.currency}
            </span>
          )}
          {isMuted(r.position.mutedUntil, localToday()) && <span className="badge badge--muted"><TagName k="muted" /></span>}
        </span>
      </div>
    ),
  },
  {
    id: 'shares',
    label: 'Acciones',
    align: 'right',
    sort: (r) => r.position.shares,
    cell: ({ position }) => (
      <div className="stack stack--right">
        <span className="num">{num(position.shares, Number.isInteger(position.shares) ? 0 : 3)}</span>
        {position.buyDate && <span className="sub">desde {shortDate(position.buyDate)}</span>}
      </div>
    ),
  },
  {
    id: 'avg',
    label: 'Precio medio',
    align: 'right',
    title: 'Precio medio de compra, en la divisa del valor',
    sort: (r) => r.position.avgPrice,
    cell: ({ position }) => <span className="num">{price(position.avgPrice)}</span>,
  },
  {
    id: 'price',
    label: 'Precio',
    align: 'right',
    title: 'Precio actual y variación del día',
    sort: (r) => r.quote?.changePct ?? null,
    cell: ({ quote }) => (
      <div className="stack stack--right">
        <span className="num">
          {price(quote?.price)}
          {quote?.stale && (
            <span className="stale" title="Sin conexión: último precio guardado">
              {' '}
              <Icon name="alert" />
            </span>
          )}
        </span>
        <span className={`sub delta ${signed(quote?.changePct)}`}>{pct(quote?.changePct)}</span>
      </div>
    ),
  },
  {
    id: 'value',
    label: 'Valor actual',
    align: 'right',
    title: 'Acciones × precio actual',
    sort: (r) => r.metrics.valueBase,
    cell: ({ metrics, quote }, base) => (
      <div className="stack stack--right">
        <span className="num">{money(metrics.valueBase, base)}</span>
        {quote?.currency && quote.currency !== base && metrics.valueNative != null && (
          <span className="sub">{money(metrics.valueNative, quote.currency)}</span>
        )}
      </div>
    ),
  },
  {
    id: 'pnl',
    label: 'Plusvalía',
    align: 'right',
    title: 'Valor actual menos lo invertido',
    sort: (r) => r.metrics.pnlPct,
    cell: ({ metrics, position }, base) => (
      <div className="stack stack--right">
        <span className={`num delta ${signed(metrics.pnlBase)}`}>{money(metrics.pnlBase, base)}</span>
        <span
          className={`sub delta ${signed(metrics.pnlPct)}`}
          title={position.costBase == null ? 'Coste calculado al cambio de hoy' : 'Sobre lo que pagaste'}
        >
          {pct(metrics.pnlPct)}
        </span>
      </div>
    ),
  },
  {
    id: 'day',
    label: 'Hoy',
    align: 'right',
    title: 'Lo que ha ganado o perdido la posición hoy',
    sort: (r) => r.metrics.dayChangeBase,
    cell: ({ metrics }, base) => (
      <span className={`num delta ${signed(metrics.dayChangeBase)}`}>{money(metrics.dayChangeBase, base)}</span>
    ),
  },
  {
    id: 'sell',
    label: 'Objetivo de venta',
    align: 'right',
    sort: (r) => (r.metrics.sellDistancePct == null ? null : -r.metrics.sellDistancePct),
    cell: ({ position, metrics }) =>
      position.sellTarget ? (
        <div className="stack stack--right">
          <span className="num">{price(position.sellTarget)}</span>
          <span className="sub">
            {SELL_LABEL[metrics.sellStatus] ? (
              <span className={`pill pill--${metrics.sellStatus === 'reached' ? 'reached' : 'near'}`}>
                {SELL_LABEL[metrics.sellStatus]}
              </span>
            ) : (
              metrics.sellDistancePct != null && `le falta ${unsigned(metrics.sellDistancePct)}`
            )}
          </span>
        </div>
      ) : (
        <span className="muted">–</span>
      ),
  },
  {
    id: 'weight',
    label: 'Peso',
    align: 'right',
    title: 'Parte de la cartera según el valor actual',
    sort: (r) => r.metrics.weight,
    cell: ({ metrics }) =>
      metrics.weight == null ? (
        <span className="muted">–</span>
      ) : (
        <div className="weight">
          <span className="num">{unsigned(metrics.weight, 0)}</span>
          <span className="weight__bar" aria-hidden>
            <span style={{ width: `${Math.max(2, metrics.weight * 100)}%` }} />
          </span>
        </div>
      ),
  },
];

function compare(a: number | string | null, b: number | string | null, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const r = typeof a === 'string' ? a.localeCompare(String(b), 'es') : a - (b as number);
  return dir === 'asc' ? r : -r;
}

function loadSort(): { id: string; dir: SortDir } {
  try {
    return { id: 'value', dir: 'desc', ...JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}') };
  } catch {
    return { id: 'value', dir: 'desc' };
  }
}

interface Props {
  view: PortfolioView | undefined;
  isPending: boolean;
  error: Error | null;
  base: string;
  onAdd: () => void;
  onEdit: (r: PortfolioRow) => void;
  onTrade: (r: PortfolioRow, type: 'buy' | 'sell') => void;
}

/** Cartera real: lo que ya tienes comprado, cuánto vale y cuánto ganas o pierdes. */
export function PortfolioPage({ view, isPending, error, base, onAdd, onEdit, onTrade }: Props) {
  const [sort, setSort] = useState(loadSort);
  const toggle = (id: string) => {
    const dir: SortDir = sort.id === id ? (sort.dir === 'asc' ? 'desc' : 'asc') : id === 'name' ? 'asc' : 'desc';
    setSort({ id, dir });
    localStorage.setItem(SORT_KEY, JSON.stringify({ id, dir }));
  };
  const rows = useMemo(() => {
    const col = columns.find((c) => c.id === sort.id);
    const all = view?.rows ?? [];
    return col?.sort ? [...all].sort((a, b) => compare(col.sort!(a), col.sort!(b), sort.dir)) : all;
  }, [view, sort]);

  if (error) return <p className="error-box">No se pudo cargar la cartera: {error.message}</p>;
  if (isPending) return <p className="muted center">Cargando la cartera…</p>;
  if (!view) return null;

  const t = view.totals;
  const reached = view.rows.filter((r) => r.metrics.sellStatus === 'reached');

  return (
    <>
      {view.rows.length > 0 && (
        <section className="highlights" aria-label="Resumen de la cartera">
          <dl className="pf-summary">
            <div>
              <dt>Valor actual</dt>
              <dd>{money(t.valueBase, base)}</dd>
            </div>
            <div>
              <dt>Invertido</dt>
              <dd>{money(t.costBase, base)}</dd>
            </div>
            <div>
              <dt>Plusvalía</dt>
              <dd className={`delta ${signed(t.pnlBase)}`}>
                {money(t.pnlBase, base)} <small>{pct(t.pnlPct)}</small>
              </dd>
            </div>
            <div>
              <dt>Hoy</dt>
              <dd className={`delta ${signed(t.dayChangeBase)}`}>{money(t.dayChangeBase, base)}</dd>
            </div>
          </dl>
          {reached.length > 0 && (
            <p className="highlights__main highlights__main--reached">
              <strong>Objetivo de venta alcanzado:</strong> {reached.map(positionName).join(', ')}.
            </p>
          )}
          {t.missing > 0 && (
            <p className="highlights__side">
              {t.missing === 1 ? '1 posición' : `${t.missing} posiciones`} sin cotización ahora mismo: no suman en los
              totales.
            </p>
          )}
        </section>
      )}

      <div className="toolbar">
        <p className="muted small">
          Lo que ya tienes comprado. Al registrar otra compra de un valor que ya tienes se recalcula el precio medio.
        </p>
        <span className="spacer" />
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          Añadir posición
        </button>
      </div>

      {view.rows.length === 0 ? (
        <div className="empty">
          <p>Todavía no tienes posiciones. Añade lo que ya has comprado para ver su valor y tu plusvalía.</p>
          <p className="muted small">También puedes pasar un valor de la lista con «Lo he comprado» al editarlo.</p>
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            Añadir la primera posición
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="wl-table pf-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`}
                    aria-sort={sort.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <button type="button" className="th-btn" onClick={() => toggle(c.id)} title={c.title}>
                      {c.label}
                      <span className="sort-ind" aria-hidden>
                        {sort.id === c.id ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="col-actions">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.position.id}
                  className={`row${r.metrics.sellStatus === 'reached' ? ' row--reached' : r.metrics.sellStatus === 'near' ? ' row--near' : ''}`}
                  onDoubleClick={() => onEdit(r)}
                >
                  {columns.map((c) => (
                    <td key={c.id} className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`} data-label={c.label}>
                      {c.cell(r, base)}
                    </td>
                  ))}
                  <td className="col-actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => onTrade(r, 'buy')}
                        title="Registrar otra compra de este valor"
                      >
                        Comprar
                      </button>
                      <button type="button" className="btn btn--small" onClick={() => onTrade(r, 'sell')} title="Registrar una venta">
                        Vender
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => onEdit(r)}
                        aria-label={`Editar ${positionName(r)}`}
                        title="Editar"
                      >
                        <Icon name="pencil" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="pf-total">
                <th scope="row" colSpan={4}>
                  Total
                </th>
                <td className="al-right num" data-label="Valor actual">
                  {money(t.valueBase, base)}
                </td>
                <td className={`al-right num delta ${signed(t.pnlBase)}`} data-label="Plusvalía">
                  {money(t.pnlBase, base)}
                </td>
                <td className={`al-right num delta ${signed(t.dayChangeBase)}`} data-label="Hoy">
                  {money(t.dayChangeBase, base)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="footnote">
        Si no indicas lo que pagaste en euros, la plusvalía de los valores en otra divisa se calcula al cambio de hoy.
      </p>
    </>
  );
}
