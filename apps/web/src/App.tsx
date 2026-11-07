import { DEFAULT_SETTINGS, type WatchlistRow } from '@watchlist/shared';
import { useEffect, useMemo, useState } from 'react';
import { useForceRefresh, useListMutations, useLists, useSettings, useWatchlist } from './api/hooks.ts';
import { ItemDialog } from './features/items/ItemDialog.tsx';
import { SettingsDialog } from './features/settings/SettingsDialog.tsx';
import { PriceMapLegend } from './features/watchlist/PriceMap.tsx';
import { Highlights } from './features/watchlist/Highlights.tsx';
import { StatusFilter, filterRow, type Filter } from './features/watchlist/StatusFilter.tsx';
import { WatchlistTable, type Tag } from './features/watchlist/WatchlistTable.tsx';
import { TagFilters, rowType, type TypeFilter } from './features/watchlist/TagFilters.tsx';
import { TOUR_STEPS } from './features/tour/steps.tsx';
import { Tour } from './features/tour/Tour.tsx';
import { num, timeAgo } from './lib/format.ts';
import { applyAppearance, applyColors } from './lib/theme.ts';
import { usePrompt } from './components/usePrompt.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { AlertsDialog } from './features/alerts/AlertsDialog.tsx';
import { WhatsNewDialog } from './components/WhatsNewDialog.tsx';

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
  useEffect(() => applyAppearance(settings), [settings.theme, settings.density, settings.fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const wl = useWatchlist(listId, settings.refreshSeconds);
  const refresh = useForceRefresh();
  const { create: createList } = useListMutations();
  const now = useNow(10_000);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WatchlistRow | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [ask, promptEl] = usePrompt();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  const view = wl.data;
  const base = view?.settings.baseCurrency ?? settings.baseCurrency;
  // Filtros por etiqueta: se aplican antes de las tarjetas, que cuentan sobre lo filtrado.
  const tagged = useMemo(
    () =>
      (view?.rows ?? []).filter(
        (r) =>
          (typeFilter === 'all' || rowType(r) === typeFilter) &&
          (currencyFilter === 'all' || (r.quote?.currency ?? '') === currencyFilter),
      ),
    [view, typeFilter, currencyFilter],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tagged
      .filter(filterRow(filter))
      .filter((r) => !q || `${r.item.symbol} ${r.item.name ?? ''} ${r.item.notes ?? ''}`.toLowerCase().includes(q));
  }, [tagged, filter, search]);
  const currencies = useMemo(
    () => [...new Set((view?.rows ?? []).map((r) => r.quote?.currency).filter((c): c is string => !!c))].sort(),
    [view],
  );
  const onTag = (tag: Tag) =>
    tag.kind === 'currency'
      ? setCurrencyFilter((c) => (c === tag.value ? 'all' : tag.value))
      : setTypeFilter((t) => (t === tag.value ? 'all' : tag.value));

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
    setTypeFilter('all');
    setCurrencyFilter('all');
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
            Nueva lista
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
            Actualizar
          </button>
          <button type="button" className="btn btn--ghost" data-tour="alerts" onClick={() => setShowAlerts(true)}>
            Avisos
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            data-tour="tour"
            onClick={startTour}
            disabled={!hasRows}
            title="Volver a ver la explicación de la app"
          >
            Guía
          </button>
          <button type="button" className="btn btn--ghost" data-tour="settings" onClick={() => setShowSettings(true)}>
            Ajustes
          </button>
        </div>
      </header>

      <main className="content">
        <UpdateBanner />
        {view?.throttledUntil && (
          <p className="notice" role="status">
            Yahoo está limitando las consultas. Se muestran los últimos precios guardados y se vuelve a intentar a las{' '}
            {new Date(view.throttledUntil).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        )}
        {view && <Highlights rows={view.rows} base={base} />}

        <div className="toolbar">
          {view && (
            <StatusFilter
              rows={tagged}
              nearPct={settings.nearThresholdPct}
              farPct={settings.farThresholdPct}
              value={filter}
              onChange={setFilter}
            />
          )}
          <TagFilters
            type={typeFilter}
            onType={setTypeFilter}
            currency={currencyFilter}
            currencies={currencies}
            onCurrency={setCurrencyFilter}
          />
          <span className="spacer" />
          <input
            type="search"
            className="search"
            placeholder="Buscar por nombre, ticker o nota"
            aria-label="Buscar en la lista"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            data-tour="add"
            onClick={() => setEditing('new')}
            disabled={!listId}
          >
            Añadir valor
          </button>
        </div>

        {wl.isError && <p className="error-box">No se pudo cargar la lista: {(wl.error as Error).message}</p>}
        {wl.isPending && listId && <p className="muted center">Cargando cotizaciones…</p>}
        {view && view.rows.length === 0 && (
          <div className="empty">
            <p>Esta lista está vacía.</p>
            <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
              Añadir el primer valor
            </button>
          </div>
        )}
        {view && view.rows.length > 0 && (
          <>
            <WatchlistTable
              rows={rows}
              baseCurrency={base}
              blink={settings.blinkReached}
              hiddenColumns={settings.hiddenColumns}
              onEdit={setEditing}
              onTag={onTag}
            />
            {rows.length === 0 && (
              <div className="empty">
                <p>Ningún valor coincide con los filtros.</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setFilter('all');
                    setTypeFilter('all');
                    setCurrencyFilter('all');
                    setSearch('');
                  }}
                >
                  Quitar filtros
                </button>
              </div>
            )}
          </>
        )}
        {view && view.rows.length > 0 && <PriceMapLegend />}
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
      <WhatsNewDialog />
      {tourOpen && <Tour steps={TOUR_STEPS} onClose={closeTour} />}
      {showSettings && <SettingsDialog settings={settings} lists={lists} onClose={() => setShowSettings(false)} />}
      {showAlerts && (
        <AlertsDialog
          itemIds={new Map((view?.rows ?? []).map((r) => [r.item.symbol, r.item.id]))}
          onClose={() => setShowAlerts(false)}
        />
      )}
    </div>
  );
}
