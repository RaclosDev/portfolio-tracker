import { computeExposure, type ExposurePart, type ExposureRow, type FundComposition } from '@watchlist/shared';
import { useMemo, useState } from 'react';
import { usePortfolioComposition } from '../../api/hooks.ts';
import { money, share } from '../../lib/format.ts';
import type { CarteraModel } from './model.ts';
import { DIRECT, exposureSources, filterExposure, NO_FILTER, type ExposureFilter } from './exposureFilter.ts';
import { DataBar, SortTable, type Column } from './SortTable.tsx';

const eur = (v: number) => <span className="num">{v ? money(v, 'EUR', 2) : '–'}</span>;

function Parts({ parts, onOpen }: { parts: ExposurePart[]; onOpen: (ticker: string) => void }) {
  return (
    <span className="exposure-parts">
      {parts.map((p) => (
        <button
          key={`${p.ticker}-${p.weight ?? 'directo'}`}
          type="button"
          className="exposure-part"
          title={`${p.name}: ${money(p.eur, 'EUR', 2)}${p.weight != null ? ` (${share(p.weight)} del fondo)` : ' en directo'}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(p.ticker);
          }}
        >
          <span className="ticker">{p.ticker}</span> <span className="num sub">{money(p.eur, 'EUR', 0)}</span>
        </button>
      ))}
    </span>
  );
}

/** De dónde sale la composición de un fondo y de cuándo es: algunas fuentes la publican con meses de retraso. */
const origin = (c: FundComposition | null | undefined) =>
  c ? `${c.source}${c.asOf ? `, a ${c.asOf.split('-').reverse().join('/')}` : ''}` : '';

/** Lo que se tiene de cada empresa sumando las acciones directas y las que llevan dentro los fondos y ETF. */
export function ExposureView({ model, onOpen }: { model: CarteraModel; onOpen: (ticker: string) => void }) {
  const compositions = usePortfolioComposition(model.valuation.open.length > 0);
  const exposure = useMemo(() => computeExposure(model.valuation.open, compositions.data ?? {}), [model.valuation.open, compositions.data]);
  const [filter, setFilter] = useState<ExposureFilter>(NO_FILTER);
  const sources = useMemo(() => exposureSources(exposure.rows), [exposure.rows]);
  const shown = useMemo(() => filterExposure(exposure.rows, exposure.totalEur, filter), [exposure, filter]);
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);
  const set = (patch: Partial<ExposureFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const toggleSource = (id: string) =>
    set({ sources: filter.sources.includes(id) ? filter.sources.filter((s) => s !== id) : [...filter.sources, id] });
  const max = Math.max(0, ...shown.map((r) => r.totalEur));
  const sum = (f: (r: ExposureRow) => number) => shown.reduce((s, r) => s + f(r), 0);

  const columns: Column<ExposureRow>[] = [
    {
      id: 'name',
      label: 'Empresa',
      sort: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <span className="stack">
          <span className="name">{r.name}</span>
          {r.isin && <span className="sub">{r.isin}</span>}
        </span>
      ),
    },
    { id: 'direct', label: 'En directo', align: 'right', sort: (r) => r.directEur, cell: (r) => eur(r.directEur), total: eur(sum((r) => r.directEur)) },
    {
      id: 'funds',
      label: 'Vía fondos',
      align: 'right',
      title: 'Parte que te toca por los fondos y ETF que la llevan en cartera',
      sort: (r) => r.fundsEur,
      cell: (r) => eur(r.fundsEur),
      total: eur(sum((r) => r.fundsEur)),
    },
    {
      id: 'total',
      label: 'Total',
      align: 'right',
      sort: (r) => r.totalEur,
      cell: (r) => (
        <DataBar value={r.totalEur} max={max}>
          <span className="num">{money(r.totalEur, 'EUR', 2)}</span>
        </DataBar>
      ),
      total: eur(sum((r) => r.totalEur)),
    },
    {
      id: 'weight',
      label: '% cartera',
      align: 'right',
      sort: (r) => r.weight,
      cell: (r) => <span className="num">{share(r.weight)}</span>,
      total: <span className="num">{share(exposure.totalEur ? sum((r) => r.totalEur) / exposure.totalEur : 0)}</span>,
    },
    { id: 'parts', label: 'De dónde sale', cell: (r) => <Parts parts={r.parts} onOpen={onOpen} /> },
  ];

  if (!exposure.rows.length && !exposure.rest.length) return <p className="empty">No hay posiciones abiertas con precio.</p>;
  return (
    <div className="exposure">
      <p className="muted exposure__note">
        Suma lo que tienes en directo y lo que llevan dentro tus fondos y ETF. De la mayoría se conoce la cartera completa; de los que solo
        se conocen sus mayores posiciones, la parte «vía fondos» es un mínimo. Lo que no se desglosa (liquidez, divisas o lo que falta) queda abajo.
        {compositions.isLoading && ' Cargando la composición de los fondos…'}
        {compositions.isError && ' No se ha podido cargar la composición de los fondos.'}
      </p>
      <div className="toolbar exposure-filters">
        <input
          type="search"
          className="search"
          placeholder="Buscar empresa o ISIN"
          aria-label="Buscar empresa"
          value={filter.q}
          onChange={(e) => set({ q: e.target.value })}
        />
        <label className="exposure-filters__check" title="Empresas que tienes por dos o más vías: en directo y en fondos, o en varios fondos">
          <input type="checkbox" checked={filter.repeated} onChange={(e) => set({ repeated: e.target.checked })} /> Solo repetidas
        </label>
        <select className="select" aria-label="Importe mínimo" value={filter.minEur} onChange={(e) => set({ minEur: Number(e.target.value) })}>
          {[0, 10, 50, 100, 500, 1000].map((v) => (
            <option key={v} value={v}>
              {v ? `Desde ${money(v, 'EUR', 0)}` : 'Cualquier importe'}
            </option>
          ))}
        </select>
        <span className="muted exposure-filters__count">
          {shown.length === exposure.rows.length ? `${shown.length} empresas` : `${shown.length} de ${exposure.rows.length} empresas`}
        </span>
        {filtered && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setFilter(NO_FILTER)}>
            Quitar filtros
          </button>
        )}
      </div>
      {sources.length > 1 && (
        <div className="exposure-parts exposure-filters__sources" role="group" aria-label="Filtrar por origen">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`exposure-part${filter.sources.includes(s.id) ? ' on' : ''}`}
              aria-pressed={filter.sources.includes(s.id)}
              title={`${s.name}: ${money(s.eur, 'EUR', 2)}. Al marcarlo, los importes son solo lo que viene de aquí.`}
              onClick={() => toggleSource(s.id)}
            >
              <span className={s.id === DIRECT ? '' : 'ticker'}>{s.label}</span> <span className="num sub">{money(s.eur, 'EUR', 0)}</span>
            </button>
          ))}
        </div>
      )}
      <SortTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.key}
        storageKey="watchlist.cartera.orden.exposicion"
        defaultSort={{ id: 'total', dir: 'desc' }}
        className="cartera-compact cartera-exposure"
      />
      {exposure.rest.length > 0 && (
        <>
          <h3 className="renta__h">
            Sin desglosar · {money(exposure.restEur, 'EUR', 2)} ({share(exposure.totalEur ? exposure.restEur / exposure.totalEur : 0)} de la cartera)
          </h3>
          <div className="table-wrap">
            <table className="wl-table cartera-table">
              <thead>
                <tr>
                  <th>Fondo</th>
                  <th className="al-right">Importe</th>
                  <th className="al-right">% del fondo</th>
                </tr>
              </thead>
              <tbody>
                {exposure.rest.map((p) => (
                  <tr key={p.ticker} className="row row--click" onClick={() => onOpen(p.ticker)}>
                    <td>
                      <span className="stack">
                        <span className="name">{p.name}</span>
                        <span className="sub">
                          {p.weight == null
                            ? compositions.isLoading ? 'Cargando su composición…' : 'Sin composición conocida'
                            : `Sin desglosar · ${origin(compositions.data?.[p.ticker])}`}
                        </span>
                      </span>
                    </td>
                    <td className="al-right num">{money(p.eur, 'EUR', 2)}</td>
                    <td className="al-right num">{share(p.weight ?? 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
