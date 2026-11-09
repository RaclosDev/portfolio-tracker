import { DEFAULT_STATUS_NAMES, DEFAULT_TAG_NAMES, isMuted, localToday, MAX_BUY_LEVELS, type LevelView, type WatchlistRow } from '@watchlist/shared';
import { useSettings } from '../../api/hooks.ts';
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { TagName } from '../../components/TagName.tsx';
import {
  compact,
  MINOR_CURRENCY,
  money,
  num,
  parseDecimal,
  pct,
  price,
  RECOMMENDATION_ES,
  shortDate,
} from '../../lib/format.ts';
import { KEY_DATE_LABEL, upcoming } from '../../lib/keyDates.ts';
import { PriceMap } from './PriceMap.tsx';
import { Sparkline } from './Sparkline.tsx';
import { ValueExpanded } from './ValueExpanded.tsx';
import { useWidth } from '../../lib/useWidth.ts';

type SortDir = 'asc' | 'desc';

/** Lo que necesitan las celdas además de la fila. */
interface CellCtx {
  base: string;
  onTag: (tag: Tag) => void;
  sparks: Record<string, number[]> | undefined;
  /** Despliega o recoge la vista ampliada del valor. */
  onToggle: (row: WatchlistRow) => void;
  isOpen: (row: WatchlistRow) => boolean;
  onSaveLevel: (row: WatchlistRow, index: number, value: number | null) => void;
}

interface Column {
  id: string;
  label: string;
  /** Encabezado de grupo (fila superior de la cabecera). */
  group?: string;
  title?: string;
  align?: 'right' | 'center';
  sort?: (r: WatchlistRow) => number | string | null;
  cell: (r: WatchlistRow, ctx: CellCtx) => ReactNode;
  /** Oculta por defecto: se activa en Ajustes → Aspecto → Columnas. */
  optional?: boolean;
}

const nextEvent = (r: WatchlistRow) => upcoming(r)[0];

/** Etiqueta pulsable de una fila (divisa o tipo) que activa el filtro correspondiente. */
export type Tag = { kind: 'currency'; value: string } | { kind: 'type'; value: 'ETF' | 'EQUITY' };



function TagButton({ tag, className, title, onTag }: { tag: Tag; className: string; title?: string; onTag: (t: Tag) => void }) {
  const names = useSettings().data?.tagNames ?? DEFAULT_TAG_NAMES;
  return (
    <button
      type="button"
      className={`badge badge--btn ${className}`}
      title={title ?? 'Filtrar por esta etiqueta'}
      onClick={(e) => {
        e.stopPropagation();
        onTag(tag);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {tag.kind === 'type' ? (tag.value === 'ETF' ? names.etf : names.equity) : tag.value}
    </button>
  );
}

/** Precio de compra editable en la propia celda: clic para cambiarlo, Enter guarda, Esc cancela. */
function LevelCell({ row, index, onSave }: { row: WatchlistRow; index: number; onSave: CellCtx['onSaveLevel'] }) {
  const level: LevelView | undefined = row.metrics.levels[index];
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  // Solo se puede añadir el siguiente nivel libre (no dejar huecos: 1, 2, 3).
  const canAdd = !level && index === row.metrics.levels.length;

  const start = () => {
    setValue(level ? String(level.price).replace('.', ',') : '');
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const n = value.trim() ? parseDecimal(value) : null;
    if (n !== null && (!Number.isFinite(n) || n <= 0)) return;
    if (n === (level?.price ?? null)) return;
    onSave(row, index, n);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      e.stopPropagation();
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        className="cell-input"
        inputMode="decimal"
        autoFocus
        aria-label={`Compra ${index + 1} de ${row.item.name ?? row.item.symbol} (vacío para quitarla)`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    );
  }
  if (!level) {
    return canAdd ? (
      <button type="button" className="cell-add" onClick={start} onDoubleClick={(e) => e.stopPropagation()} title="Añadir precio de compra">
        Añadir
      </button>
    ) : (
      <span className="muted">–</span>
    );
  }
  return (
    <button
      type="button"
      className="cell-edit stack stack--right"
      onClick={start}
      onDoubleClick={(e) => e.stopPropagation()}
      title="Pulsa para cambiar el precio"
    >
      <span className="num">{price(level.price, row.quote?.currency)}</span>
      <span className={`pill pill--${level.status}`} title={level.status === 'unknown' ? undefined : names[level.status]}>
        {level.status === 'reached' ? '✓ ' : ''}
        {pct(level.distancePct)}
      </span>
    </button>
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
    cell: (r, { base, onTag, onToggle, isOpen }) => {
      const { item, quote } = r;
      return (
        <div className="stack">
          <button
            type="button"
            className="name name-btn"
            title={isOpen(r) ? 'Recoger el detalle' : 'Ver el detalle'}
            aria-expanded={isOpen(r)}
            aria-controls={`detalle-${item.id}`}
            onClick={() => onToggle(r)}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {item.name ?? item.symbol}
          </button>
          <span className="sub">
            <span className="ticker">{item.symbol}</span>
            {quote?.exchange && <> · {quote.exchange}</>}
            {/* Etiquetas de divisa y tipo en todas las filas; la divisa distinta de la base lleva color. */}
            {quote?.currency && (
              <TagButton
                tag={{ kind: 'currency', value: quote.currency }}
                className={quote.currency !== base ? 'badge--fx' : ''}
                title={`${MINOR_CURRENCY[quote.currency] ? MINOR_CURRENCY[quote.currency] + '. ' : ''}Pulsa para ver solo ${quote.currency}`}
                onTag={onTag}
              />
            )}
            {(quote?.quoteType === 'ETF' || quote?.quoteType === 'EQUITY') && (
              <TagButton
                tag={{ kind: 'type', value: quote.quoteType }}
                className={quote.quoteType === 'ETF' ? 'badge--etf' : 'badge--equity'}
                title={`Pulsa para ver solo ${quote.quoteType === 'ETF' ? 'ETF' : 'acciones'}`}
                onTag={onTag}
              />
            )}
            {isMuted(item.mutedUntil, localToday()) && (
              <span
                className="badge badge--muted"
                title={item.mutedUntil === 'always' ? 'Avisos silenciados' : `Avisos silenciados hasta el ${shortDate(item.mutedUntil)}`}
              >
                <TagName k="muted" />
              </span>
            )}
          </span>
        </div>
      );
    },
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
          {price(quote?.price, quote?.currency)}
          {quote?.stale && (
            <span className="stale" title={`Sin conexión: dato guardado del ${new Date(quote.fetchedAt).toLocaleString('es-ES')}`}>
              <Icon name="alert" label="Dato sin actualizar" />
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
    id: 'trend',
    label: 'Tendencia 3 m',
    title: 'Evolución de los últimos 3 meses',
    cell: (r, { sparks }) => <Sparkline closes={sparks?.[r.item.symbol]} level={r.item.buyPrices[0]} currency={r.quote?.currency} />,
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
    label: `${i + 1}`,
    group: 'Precios de compra',
    title: `Ordena por distancia a la compra ${i + 1}`,
    align: 'right',
    sort: (r) => r.metrics.levels[i]?.distancePct ?? null,
    cell: (r, { onSaveLevel }) => <LevelCell row={r} index={i} onSave={onSaveLevel} />,
  })),
  {
    id: 'broker',
    label: 'Bróker',
    group: 'Objetivos',
    align: 'right',
    sort: (r) => r.metrics.upsideBrokerPct,
    cell: ({ item, metrics, quote }) =>
      item.brokerTarget == null ? (
        <span className="muted">–</span>
      ) : (
        <div className="stack stack--right">
          <span className="num">
            {price(item.brokerTarget, quote?.currency)} <Upside value={metrics.upsideBrokerPct} />
          </span>
          {item.brokerName && <span className="sub">{item.brokerName}</span>}
        </div>
      ),
  },
  {
    id: 'consensus',
    label: 'Consenso',
    group: 'Objetivos',
    align: 'right',
    sort: (r) => r.metrics.upsideConsensusPct,
    cell: ({ targets, metrics, quote }) =>
      targets?.mean == null ? (
        <span className="muted">–</span>
      ) : (
        <div
          className="stack stack--right"
          title={`Media ${price(targets.mean, quote?.currency)} · mediana ${price(targets.median, quote?.currency)} · rango ${price(targets.low, quote?.currency)}–${price(targets.high, quote?.currency)}`}
        >
          <span className="num">
            {price(targets.mean, quote?.currency)} <Upside value={metrics.upsideConsensusPct} />
          </span>
          <span className="sub">
            {targets.analysts ?? '?'} analistas
            {targets.recommendation && targets.recommendation !== 'none' && ` · ${RECOMMENDATION_ES[targets.recommendation] ?? targets.recommendation}`}
          </span>
        </div>
      ),
  },
  {
    id: 'events',
    label: 'Fechas clave',
    group: 'Datos',
    optional: true,
    title: 'Próxima presentación de resultados y próxima fecha ex-dividendo',
    sort: (r) => nextEvent(r)?.days ?? null,
    cell: (r) => {
      const ev = upcoming(r);
      if (!ev.length) return <span className="muted">–</span>;
      return (
        <div className="stack">
          {ev.map((e) => (
            <span key={e.kind} className={e.days <= 7 ? 'event event--soon' : 'event'}>
              {KEY_DATE_LABEL[e.kind]} {shortDate(e.date)}
              {' '}<span className="muted">· {e.days === 0 ? 'hoy' : `${e.days} d`}</span>
            </span>
          ))}
        </div>
      );
    },
  },
  {
    id: 'per',
    label: 'PER',
    group: 'Datos',
    optional: true,
    align: 'right',
    title: 'Precio / beneficio de los últimos 12 meses',
    sort: (r) => r.targets?.trailingPE ?? null,
    cell: ({ targets }) => <span className="num">{num(targets?.trailingPE, 1)}</span>,
  },
  {
    id: 'yield',
    label: 'Rent. div.',
    group: 'Datos',
    optional: true,
    align: 'right',
    title: 'Rentabilidad por dividendo anual al precio actual',
    sort: (r) => r.targets?.dividendYield ?? null,
    cell: ({ targets }) => (
      <span className="num">{targets?.dividendYield ? pct(targets.dividendYield).replace('+', '') : '–'}</span>
    ),
  },
  {
    id: 'mcap',
    label: 'Capitaliz.',
    group: 'Datos',
    optional: true,
    align: 'right',
    title: 'Capitalización bursátil en la divisa del valor',
    sort: (r) => r.targets?.marketCap ?? null,
    cell: ({ targets, quote }) => (
      <span className="num">{compact(targets?.marketCap, quote?.currency === 'GBp' ? 'GBP' : quote?.currency)}</span>
    ),
  },
  {
    id: 'shares',
    label: 'Acciones',
    group: 'Compra prevista',
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
    group: 'Compra prevista',
    align: 'right',
    sort: (r) => r.metrics.netBase,
    title: 'Acciones × precio de entrada',
    cell: ({ metrics, quote }, { base }) => (
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
    label: 'Ahorro',
    group: 'Compra prevista',
    align: 'right',
    sort: (r) => r.metrics.diffBase,
    title: 'Lo que ahorras frente a comprar hoy: acciones × (precio actual − precio de entrada)',
    cell: ({ metrics }, { base }) => <span className="num">{money(metrics.diffBase, base)}</span>,
  },
  {
    id: 'order',
    label: 'Orden',
    sort: (r) => (r.item.orderActive ? (r.metrics.orderDaysLeft ?? 9999) : null),
    cell: ({ item, metrics, quote }) =>
      item.orderActive ? (
        <div className="stack">
          <span className={`badge ${metrics.orderExpired ? 'badge--danger' : 'badge--order'}`}>
            {metrics.orderExpired ? 'Caducada' : 'Activa'} {item.orderPrice != null && `@ ${price(item.orderPrice, quote?.currency)}`}
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

/** Nombre completo de cada columna (para Ajustes y para la vista en tarjetas). */
const fullLabel = (c: Column) => (c.group === 'Precios de compra' ? `Compra ${c.label}` : c.group === 'Objetivos' ? `Objetivo ${c.label.toLowerCase()}` : c.label);

function compare(a: number | string | null, b: number | string | null, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // vacíos siempre al final
  if (b == null) return -1;
  const r = typeof a === 'string' ? a.localeCompare(String(b), 'es') : a - (b as number);
  return dir === 'asc' ? r : -r;
}

interface Props {
  rows: WatchlistRow[];
  listId: number;
  baseCurrency: string;
  blink: boolean;
  hiddenColumns: string[];
  extraColumns: string[];
  sparks: Record<string, number[]> | undefined;
  onEdit: (row: WatchlistRow) => void;
  onTag: (tag: Tag) => void;
  onSaveLevel: CellCtx['onSaveLevel'];
}

/** Columnas que se pueden ocultar desde Ajustes → Aspecto (todas menos "Valor"). */
export const COLUMN_OPTIONS = columns
  .filter((c) => c.id !== 'name')
  .map((c) => ({ id: c.id, label: fullLabel(c), optional: !!c.optional }));

/** Una columna se ve si es normal y no está oculta, o si es opcional y se ha activado. */
export const isColumnVisible = (c: { id: string; optional?: boolean }, hidden: string[], extra: string[]) =>
  c.optional ? extra.includes(c.id) : !hidden.includes(c.id);

const DEFAULT_SORT = { id: 'map', dir: 'desc' as SortDir }; // lo más cercano a un nivel de compra, arriba
const sortKey = (listId: number) => `watchlist.orden.${listId}`;

export function WatchlistTable({ rows, listId, baseCurrency, blink, hiddenColumns, extraColumns, sparks, onEdit, onTag, onSaveLevel }: Props) {
  const [wrapRef, wrapWidth] = useWidth<HTMLDivElement>();
  const visible = useMemo(
    () => columns.filter((c) => isColumnVisible(c, hiddenColumns, extraColumns)),
    [hiddenColumns, extraColumns],
  );

  // El orden elegido se recuerda por lista.
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>(DEFAULT_SORT);
  useEffect(() => {
    try {
      setSort({ ...DEFAULT_SORT, ...JSON.parse(localStorage.getItem(sortKey(listId)) ?? '{}') });
    } catch {
      setSort(DEFAULT_SORT);
    }
  }, [listId]);
  const changeSort = (next: { id: string; dir: SortDir }) => {
    setSort(next);
    localStorage.setItem(sortKey(listId), JSON.stringify(next));
  };

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => compare(col.sort!(a), col.sort!(b), sort.dir));
  }, [rows, sort]);

  const toggle = (id: string) =>
    changeSort(sort.id === id ? { id, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: id === 'name' ? 'asc' : 'desc' });

  // Fila de grupos: columnas consecutivas con el mismo grupo comparten encabezado.
  const groups = useMemo(() => {
    const out: { label: string; span: number }[] = [];
    for (const c of visible) {
      const label = c.group ?? '';
      const last = out[out.length - 1];
      if (last && last.label === label && label) last.span++;
      else out.push({ label, span: 1 });
    }
    return out;
  }, [visible]);
  const hasGroups = groups.some((g) => g.label);

  // Valores desplegados (vista ampliada bajo su fila). Un clic en la fila la abre o la cierra.
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const onToggle = (r: WatchlistRow) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(r.item.id)) next.add(r.item.id);
      return next;
    });
  const isOpen = (r: WatchlistRow) => open.has(r.item.id);
  const onRowClick = (r: WatchlistRow) => (e: MouseEvent<HTMLTableRowElement>) => {
    // Los botones, campos y etiquetas de la fila hacen lo suyo; el segundo clic de un doble clic, tampoco.
    if (e.detail > 1 || (e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
    onToggle(r);
  };

  const ctx: CellCtx = { base: baseCurrency, onTag, sparks, onToggle, isOpen, onSaveLevel };

  return (
    <div className="table-wrap" ref={wrapRef}>
      <table className={`wl-table${blink ? ' wl-table--blink' : ''}`}>
        <thead>
          {hasGroups && (
            <tr className="group-row">
              {groups.map((g, i) => (
                <th key={i} colSpan={g.span} className={g.label ? 'group' : 'group group--empty'} scope="colgroup">
                  {g.label}
                </th>
              ))}
              <th className="group group--empty" />
            </tr>
          )}
          <tr>
            {visible.map((c) => (
              <th
                key={c.id}
                className={`${c.align ? `al-${c.align}` : ''} col-${c.id}${c.group ? ' in-group' : ''}`}
                aria-sort={sort.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                aria-label={c.group ? fullLabel(c) : undefined}
              >
                {c.sort ? (
                  <button type="button" className="th-btn" onClick={() => toggle(c.id)} title={c.title}>
                    {c.label}
                    <span className="sort-ind" aria-hidden>
                      {sort.id === c.id ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                ) : (
                  <span title={c.title}>{c.label}</span>
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
            <Fragment key={r.item.id}>
            <tr
              id={`fila-${r.item.id}`}
              className={`row row--${r.metrics.status}${r.item.orderActive ? ' row--order' : ''}${isOpen(r) ? ' row--open' : ''}`}
              onClick={onRowClick(r)}
              onDoubleClick={() => {
                onToggle(r); // deshace el despliegue del primer clic
                onEdit(r);
              }}
            >
              {visible.map((c) => (
                <Fragment key={c.id}>
                  <td className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`} data-label={fullLabel(c)}>
                    {c.cell(r, ctx)}
                  </td>
                </Fragment>
              ))}
              <td className="col-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onEdit(r)}
                  aria-label={`Editar ${r.item.name ?? r.item.symbol}`}
                  title="Editar"
                >
                  <Icon name="pencil" />
                </button>
              </td>
            </tr>
            {isOpen(r) && (
              <tr className="row-expand" id={`detalle-${r.item.id}`}>
                <td colSpan={visible.length + 1}>
                  <ValueExpanded
                    row={r}
                    base={baseCurrency}
                    width={wrapWidth || undefined}
                    onEdit={() => onEdit(r)}
                    onClose={() => onToggle(r)}
                  />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
