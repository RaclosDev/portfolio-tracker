import { DEFAULT_SETTINGS, type WatchlistRow } from '@watchlist/shared';
import { useEffect, useMemo, useState } from 'react';
import { useForceRefresh, useListMutations, useLists, useSettings, useWatchlist } from './api/hooks.ts';
import { ItemDialog } from './features/items/ItemDialog.tsx';
import { SettingsDialog } from './features/settings/SettingsDialog.tsx';
import { PriceMapLegend } from './features/watchlist/PriceMap.tsx';
import { Summary, filterRow, type Filter } from './features/watchlist/Summary.tsx';
import { WatchlistTable } from './features/watchlist/WatchlistTable.tsx';
import { TOUR_STEPS } from './features/tour/steps.tsx';
import { Tour } from './features/tour/Tour.tsx';
import { num, timeAgo } from './lib/format.ts';
import { applyColors } from './lib/theme.ts';
import { usePrompt } from './components/usePrompt.tsx';

const LS_LIST = 'watchlist.listId';
const LS_TOUR = 'watchlist.tourSeen';

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function App() {
  const settingsQ = useSettings();
  const listsQ = useLists();
  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const lists = listsQ.data ?? [];

  const [listId, setListId] = useState<number | null>(() => Number(localStorage.getItem(LS_LIST)) || null);
  useEffect(() => {
    if (lists.length && !lists.some((l) => l.id === listId)) setListId(lists[0]!.id);
  }, [lists, listId]);
  useEffect(() => {
    if (listId) localStorage.setItem(LS_LIST, String(listId));
  }, [listId]);

  useEffect(() => applyColors(settings.colors), [settings.colors]);

  const wl = useWatchlist(listId, settings.refreshSeconds);
  const refresh = useForceRefresh();
  const { create: createList } = useListMutations();
  const now = useNow(10_000);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WatchlistRow | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [ask, promptEl] = usePrompt();

  const view = wl.data;
  const base = view?.settings.baseCurrency ?? settings.baseCurrency;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (view?.rows ?? [])
      .filter(filterRow(filter))
      .filter((r) => !q || `${r.item.symbol} ${r.item.name ?? ''} ${r.item.notes ?? ''}`.toLowerCase().includes(q));
  }, [view, filter, search]);

  // El tour se abre solo la primera vez, cuando ya hay datos que enseñar.
  const hasRows = (view?.rows.length ?? 0) > 0;
  useEffect(() => {
    if (hasRows && !localStorage.getItem(LS_TOUR)) setTourOpen(true);
  }, [hasRows]);
  const closeTour = () => {
    localStorage.setItem(LS_TOUR, '1');
    setTourOpen(false);
  };
  const startTour = () => {
    setFilter('all');
    setSearch('');
    setTourOpen(true);
  };

  // Solo divisas principales: GBp (peniques) comparte tipo con GBP y no se repite.
  const fxChips = Object.entries(view?.fx ?? {}).filter(([c]) => c !== base && /^[A-Z]{3}$/.test(c));
  const anyStale = view?.rows.some((r) => r.quote?.stale);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <h1>Watchlist</h1>
        </div>

        <nav className="tabs" aria-label="Listas">
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`tab${l.id === listId ? ' tab--active' : ''}`}
              aria-current={l.id === listId ? 'page' : undefined}
              onClick={() => setListId(l.id)}
            >
              {l.name}
              <span className="tab__count">{l.itemCount}</span>
            </button>
          ))}
          <button
            type="button"
            className="tab tab--add"
            title="Nueva lista"
            onClick={async () => {
              const name = await ask('Nueva lista', 'Nombre de la lista');
              if (name) setListId((await createList.mutateAsync(name)).id);
            }}
          >
            + Lista
          </button>
        </nav>

        <div className="topbar__right">
          {fxChips.map(([c, r]) => (
            <span key={c} className="chip" title={`1 ${base} = ${r} ${c}`}>
              {base}/{c} <strong>{num(r, 4)}</strong>
            </span>
          ))}
          <span className={`updated${anyStale ? ' updated--stale' : ''}`} aria-live="polite">
            {wl.isFetching || refresh.isPending
              ? 'Actualizando…'
              : anyStale
                ? 'Sin conexión: datos guardados'
                : `Actualizado ${timeAgo(view?.generatedAt, now)}`}
          </span>
          <button
            type="button"
            className="btn"
            data-tour="refresh"
            onClick={() => listId && refresh.mutate(listId)}
            disabled={!listId || refresh.isPending}
            title="Forzar actualización de cotizaciones"
          >
            ↻ Actualizar
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-tour="tour"
            onClick={startTour}
            disabled={!hasRows}
            title="Volver a ver la explicación de la app"
          >
            ? Tour
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tour="settings"
            onClick={() => setShowSettings(true)}
            aria-label="Ajustes"
            title="Ajustes"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="content">
        {view && (
          <Summary rows={view.rows} base={base} nearPct={settings.nearThresholdPct} filter={filter} onFilter={setFilter} />
        )}

        <div className="toolbar">
          <input
            type="search"
            className="search"
            placeholder="Filtrar por nombre, ticker o nota…"
            aria-label="Filtrar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <PriceMapLegend />
          <span className="spacer" />
          <button
            type="button"
            className="btn btn--primary"
            data-tour="add"
            onClick={() => setEditing('new')}
            disabled={!listId}
          >
            + Añadir valor
          </button>
        </div>

        {wl.isError && <p className="error-box">No se pudo cargar la lista: {(wl.error as Error).message}</p>}
        {wl.isPending && listId && <p className="muted center">Cargando cotizaciones…</p>}
        {view && view.rows.length === 0 && (
          <div className="empty">
            <p>Esta lista está vacía.</p>
            <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
              + Añadir el primer valor
            </button>
          </div>
        )}
        {view && view.rows.length > 0 && (
          <>
            <WatchlistTable rows={rows} baseCurrency={base} onEdit={setEditing} />
            {rows.length === 0 && <p className="muted center">Ningún valor coincide con el filtro.</p>}
          </>
        )}
        <p className="footnote">
          Cotizaciones y consenso de analistas: Yahoo Finance (pueden tener retraso). Doble clic en una fila para editarla.
        </p>
      </main>

      {editing && listId && (
        <ItemDialog
          listId={listId}
          row={editing === 'new' ? null : editing}
          settings={view?.settings ?? settings}
          fx={view?.fx ?? {}}
          onClose={() => setEditing(null)}
        />
      )}
      {promptEl}
      {tourOpen && <Tour steps={TOUR_STEPS} onClose={closeTour} />}
      {showSettings && <SettingsDialog settings={settings} lists={lists} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
