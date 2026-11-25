import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type SortDir = 'asc' | 'desc';

export interface Column<T> {
  id: string;
  label: string;
  title?: string;
  align?: 'right';
  sort?: (r: T) => number | string | null;
  cell: (r: T) => ReactNode;
  /** Celda de la fila de totales. */
  total?: ReactNode;
}

function compare(a: number | string | null, b: number | string | null, dir: SortDir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const r = typeof a === 'string' ? a.localeCompare(String(b), 'es') : a - (b as number);
  return dir === 'asc' ? r : -r;
}

function load(key: string, fallback: { id: string; dir: SortDir }) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') } as { id: string; dir: SortDir };
  } catch {
    return fallback;
  }
}

/** Tabla con columnas ordenables (el orden se recuerda) y fila de totales opcional. */
export function SortTable<T>({
  rows,
  columns,
  rowKey,
  storageKey,
  defaultSort,
  onRowClick,
  rowClass,
  className = '',
  totalLabel,
  expanded,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string | number;
  storageKey: string;
  defaultSort: { id: string; dir: SortDir };
  onRowClick?: (r: T) => void;
  rowClass?: (r: T) => string;
  className?: string;
  totalLabel?: string;
  /** Detalle desplegado bajo una fila (o null si está cerrada). */
  expanded?: (r: T, sorted: T[]) => ReactNode | null;
}) {
  const [sort, setSort] = useState(() => load(storageKey, defaultSort));
  const toggle = (id: string, numeric: boolean) => {
    const dir: SortDir = sort.id === id ? (sort.dir === 'asc' ? 'desc' : 'asc') : numeric ? 'desc' : 'asc';
    setSort({ id, dir });
    localStorage.setItem(storageKey, JSON.stringify({ id, dir }));
  };
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort.id);
    return col?.sort ? [...rows].sort((a, b) => compare(col.sort!(a), col.sort!(b), sort.dir)) : rows;
  }, [rows, columns, sort]);
  const hasTotal = columns.some((c) => c.total !== undefined);
  const table = useRef<HTMLTableElement>(null);
  // En móvil la tabla oculta columnas: el detalle desplegado abarca solo las que se ven, o la tabla
  // crearía columnas vacías para él y estrecharía las demás.
  const [span, setSpan] = useState(columns.length);
  const anyOpen = !!expanded && sorted.some((r) => expanded(r, sorted) != null);
  useLayoutEffect(() => {
    if (!anyOpen) return;
    const count = () => {
      // Solo la cabecera de esta tabla: las del desplegable (Lotes, Operaciones) también tienen <th>.
      const ths = table.current?.querySelectorAll<HTMLElement>(':scope > thead > tr > th') ?? [];
      setSpan([...ths].filter((th) => getComputedStyle(th).display !== 'none').length || columns.length);
    };
    count();
    window.addEventListener('resize', count);
    return () => window.removeEventListener('resize', count);
  }, [anyOpen, columns.length]);

  return (
    <div className="table-wrap">
      <table ref={table} className={`wl-table cartera-table ${className}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`}
                aria-sort={sort.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {c.sort ? (
                  <button type="button" className="th-btn" onClick={() => toggle(c.id, c.align === 'right')} title={c.title}>
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
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const open = expanded?.(r, sorted) ?? null;
            return (
              <Fragment key={rowKey(r)}>
                <tr
                  className={`row${onRowClick ? ' row--click' : ''}${open ? ' row--open' : ''} ${rowClass?.(r) ?? ''}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  aria-expanded={expanded ? !!open : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.id} className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`} data-label={c.label}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr className="row-expand">
                    <td colSpan={span}>{open}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {hasTotal && (
          <tfoot>
            <tr className="pf-total">
              {columns.map((c, i) => (
                <td key={c.id} className={`${c.align ? `al-${c.align}` : ''} col-${c.id}`}>
                  {i === 0 ? (c.total ?? totalLabel ?? 'Total') : c.total}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Barra horizontal proporcional dentro de una celda (como las barras de datos de Excel). */
export function DataBar({ value, max, children }: { value: number | null | undefined; max: number; children: ReactNode }) {
  const w = value != null && max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <span className="databar">
      <span className={`databar__fill${value != null && value < 0 ? ' databar__fill--neg' : ''}`} style={{ width: `${w}%` }} aria-hidden />
      <span className="databar__text">{children}</span>
    </span>
  );
}
