import { DEFAULT_SETTINGS, type WatchlistRow } from '@watchlist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api/client.ts';
import { keys, useForceRefresh, useListMutations, useLists, usePortfolio, useSaveItem, useSettings, useWatchlist } from './api/hooks.ts';
import { CarteraPage } from './features/cartera/CarteraPage.tsx';
import type { OperationDraft } from './features/cartera/OperationDialog.tsx';
import { useCarteraModel } from './features/cartera/model.ts';
import { ItemDialog } from './features/items/ItemDialog.tsx';
import { SettingsDialog } from './features/settings/SettingsDialog.tsx';
import { PriceMapLegend } from './features/watchlist/PriceMap.tsx';
import { Highlights, goToRow } from './features/watchlist/Highlights.tsx';
import { Dialog } from './components/Dialog.tsx';
import { StatusFilter, filterRow, type Filter } from './features/watchlist/StatusFilter.tsx';
import { WatchlistTable, type Tag } from './features/watchlist/WatchlistTable.tsx';
import { TagFilters, rowType, type TypeFilter } from './features/watchlist/TagFilters.tsx';
import { TOUR_STEPS } from './features/tour/steps.tsx';
import { Tour } from './features/tour/Tour.tsx';
import { num, timeAgo } from './lib/format.ts';
import { applyAppearance, applyColors } from './lib/theme.ts';
import { usePrompt } from './components/usePrompt.tsx';
import { Icon } from './components/Icon.tsx';
import { PushBanner } from './components/PushBanner.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { AlertsDialog } from './features/alerts/AlertsDialog.tsx';

const LS_LIST = 'watchlist.listId';
const LS_TOUR = 'watchlist.tourSeen';
const LS_PAGE = 'watchlist.pagina';
type Page = 'lista' | 'cartera';

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

  // Página visible: una lista de vigilancia o la cartera real.
  const [page, setPage] = useState<Page>(() => (localStorage.getItem(LS_PAGE) === 'cartera' ? 'cartera' : 'lista'));
  useEffect(() => localStorage.setItem(LS_PAGE, page), [page]);
  const onPortfolio = page === 'cartera';

  const wl = useWatchlist(listId, settings.refreshSeconds);
  // La cartera se refresca al ritmo normal solo cuando se está viendo; si no, cada 5 min (para el contador).
  const pf = usePortfolio(onPortfolio ? settings.refreshSeconds : 300);
  const carteraModel = useCarteraModel(pf.data);
  const refresh = useForceRefresh();
  const qc = useQueryClient();
  const [pfRefreshing, setPfRefreshing] = useState(false);
  const refreshPortfolio = async () => {
    setPfRefreshing(true);
    try {
      qc.setQueryData(keys.portfolio, await api.portfolio(true));
    } finally {
      setPfRefreshing(false);
    }
  };
  const [buyDraft, setBuyDraft] = useState<OperationDraft | null>(null);
  const clearDraft = useCallback(() => setBuyDraft(null), []);
  const { create: createList } = useListMutations();
  const now = useNow(10_000);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [locateId, setLocateId] = useState<number | null>(null);
  const [editing, setEditing] = useState<WatchlistRow | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [ask, promptEl] = usePrompt();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');

  // Los filtros se recuerdan por lista (se restauran al volver a ella o al reabrir la app).
  const filtersKey = listId ? `watchlist.filtros.${listId}` : null;
  useEffect(() => {
    if (!filtersKey) return;
    try {
      const f = JSON.parse(localStorage.getItem(filtersKey) ?? '{}') as { status?: Filter; type?: TypeFilter; currency?: string };
      setFilter(f.status ?? 'all');
      setTypeFilter(f.type ?? 'all');
      setCurrencyFilter(f.currency ?? 'all');
    } catch {
      /* filtros guardados no válidos: se ignoran */
    }
  }, [filtersKey]);
  useEffect(() => {
    if (filtersKey) localStorage.setItem(filtersKey, JSON.stringify({ status: filter, type: typeFilter, currency: currencyFilter }));
  }, [filtersKey, filter, typeFilter, currencyFilter]);

  const saveItem = useSaveItem();
  const onSaveLevel = (row: WatchlistRow, index: number, value: number | null) => {
    const next = [...row.item.buyPrices];
    if (value == null) next.splice(index, 1);
    else next[index] = value;
    saveItem.mutate({ id: row.item.id, data: { buyPrices: next } });
  };

  const view = wl.data;
  const symbols = useMemo(() => (view?.rows ?? []).map((r) => r.item.symbol).sort(), [view]);
  const sparks = useQuery({
    queryKey: ['sparks', symbols.join(',')],
    queryFn: () => api.sparklines(symbols),
    enabled: symbols.length > 0,
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
  });
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

  const activeFilters = [filter, typeFilter, currencyFilter].filter((value) => value !== 'all').length;
  const clearFilters = () => {
    setFilter('all');
    setTypeFilter('all');
    setCurrencyFilter('all');
  };
  const locateRow = (id: number) => {
    if (rows.some((row) => row.item.id === id)) {
      goToRow(id);
    } else {
      clearFilters();
      setSearch('');
      setLocateId(id);
    }
  };
  useEffect(() => {
    if (locateId === null || !rows.some((row) => row.item.id === locateId)) return;
    goToRow(locateId);
    setLocateId(null);
  }, [locateId, rows]);

  const filterControls = (
    <>
      {view && <StatusFilter rows={tagged} bands={settings.bands} names={settings.statusNames} value={filter} onChange={setFilter} />}
      <TagFilters type={typeFilter} onType={setTypeFilter} currency={currencyFilter} currencies={currencies} onCurrency={setCurrencyFilter} names={settings.tagNames} />
    </>
  );

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
  const fxChips = Object.entries((onPortfolio ? pf.data?.fx : view?.fx) ?? {}).filter(([c]) => c !== base && /^[A-Z]{3}$/.test(c));
  const anyStale = onPortfolio
    ? Object.values(pf.data?.quotes ?? {}).some((q) => q.stale)
    : view?.rows.some((r) => r.quote?.stale);
  const fetching = onPortfolio ? pf.isFetching || pfRefreshing : wl.isFetching || refresh.isPending;
  const generatedAt = onPortfolio ? pf.data?.generatedAt : view?.generatedAt;
  const refetchFailed = onPortfolio ? pf.isRefetchError : wl.isRefetchError;
  const updateLabel = fetching ? 'Actualizando…'
    : refetchFailed ? `Sin conexión con el servidor · precios de ${timeAgo(generatedAt, now)}`
    : anyStale ? 'Sin conexión: datos guardados'
    : `Actualizado ${timeAgo(generatedAt, now)}`;
  const fxBadges = fxChips.map(([currency, rate]) => (
    <span key={currency} className="chip" title={`1 ${base} = ${rate} ${currency}`}>
      {base}/{currency} <strong>{num(rate, 4)}</strong>
    </span>
  ));

  // Con la app en segundo plano (pantalla apagada, ventana minimizada) el navegador para los
  // temporizadores. Si al volver los precios llevan más de dos ciclos sin renovarse, se piden ya.
  const ageMs = generatedAt ? now - Date.parse(generatedAt) : 0;
  const tooOld = ageMs > Math.max(2 * settings.refreshSeconds * 1000, 90_000);
  useEffect(() => {
    if (!tooOld || fetching || document.visibilityState !== 'visible') return;
    if (onPortfolio) void pf.refetch();
    else if (listId) void wl.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooOld, now]);
  const throttledUntil = onPortfolio ? pf.data?.throttledUntil : view?.throttledUntil;
  // Las pausas cortas (1–2 min, suelen pasar tras publicar una versión) no merecen aviso.
  const throttleLeftMs = throttledUntil ? Date.parse(throttledUntil) - now : 0;
  const throttleMin = throttleLeftMs > 3 * 60_000 ? Math.ceil(throttleLeftMs / 60_000) : null;

  const newList = async () => {
    const name = await ask('Nueva lista', 'Nombre de la lista');
    if (name) {
      setListId((await createList.mutateAsync(name)).id);
      setPage('lista');
    }
  };

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
              className={`tab${!onPortfolio && l.id === listId ? ' tab--active' : ''}`}
              aria-current={!onPortfolio && l.id === listId ? 'page' : undefined}
              onClick={() => {
                setListId(l.id);
                setPage('lista');
              }}
            >
              {l.name}
              <span className="tab__count">{l.itemCount}</span>
            </button>
          ))}
          <button type="button" className="tab tab--add" title="Nueva lista" onClick={newList}>
            Nueva lista
          </button>
          <span className="tabs__sep" aria-hidden />
          <button
            type="button"
            className={`tab${onPortfolio ? ' tab--active' : ''}`}
            aria-current={onPortfolio ? 'page' : undefined}
            data-tour="portfolio"
            onClick={() => setPage('cartera')}
            title="Lo que ya tienes comprado"
          >
            Cartera
            {carteraModel && <span className="tab__count">{carteraModel.valuation.open.length}</span>}
          </button>
        </nav>

        <div className="list-picker">
          {onPortfolio ? <strong className="list-picker__title">Cartera</strong> : (
            <>
              <select
                className="list-picker__select"
                aria-label="Seleccionar lista"
                value={String(listId ?? '')}
                onChange={(e) => {
                  setListId(Number(e.target.value));
                  setPage('lista');
                }}
              >
                <optgroup label="Listas">
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <button type="button" className="icon-btn" aria-label="Nueva lista" title="Nueva lista" onClick={newList}>
                <Icon name="plus" size={20} />
              </button>
            </>
          )}
        </div>

        <nav className="mobile-primary-nav" aria-label="Secciones">
          <button type="button" aria-current={!onPortfolio ? 'page' : undefined} onClick={() => setPage('lista')}>
            Lista
          </button>
          <button type="button" aria-current={onPortfolio ? 'page' : undefined} onClick={() => setPage('cartera')}>
            Cartera
          </button>
        </nav>

        <div className="topbar__right">
          {fxBadges}
          <span className={`updated${anyStale || refetchFailed ? ' updated--stale' : ''}`} aria-live="polite">
            {updateLabel}
          </span>
          <button
            type="button"
            className="btn"
            data-tour="refresh"
            onClick={() => (onPortfolio ? void refreshPortfolio() : listId && refresh.mutate(listId))}
            disabled={onPortfolio ? pfRefreshing : !listId || refresh.isPending}
            title="Forzar actualización de cotizaciones"
            aria-label="Actualizar"
          >
            <span className={`btn__icon${fetching ? ' btn__icon--spin' : ''}`}>
              <Icon name="refresh" size={20} />
            </span>
            <span className="btn__label">Actualizar</span>
          </button>
          <button type="button" className="btn btn--ghost" data-tour="alerts" aria-label="Avisos" title="Avisos" onClick={() => setShowAlerts(true)}>
            <span className="btn__icon">
              <Icon name="bell" size={20} />
            </span>
            <span className="btn__label">Avisos</span>
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
          <button type="button" className="btn btn--ghost" data-tour="settings" aria-label="Ajustes" title="Ajustes" onClick={() => setShowSettings(true)}>
            <span className="btn__icon">
              <Icon name="gear" size={20} />
            </span>
            <span className="btn__label">Ajustes</span>
          </button>
        </div>
      </header>

      <main className="content">
        <UpdateBanner />
        <PushBanner />
        {throttleMin != null && (
          <p className="notice" role="status">
            Yahoo ha pedido ir más despacio. Mientras tanto ves los últimos precios guardados; se vuelve a consultar en{' '}
            {throttleMin} min.
          </p>
        )}
        {onPortfolio ? (
          <CarteraPage
            model={carteraModel}
            isPending={pf.isPending}
            error={pf.error}
            draft={buyDraft}
            onDraftUsed={clearDraft}
          />
        ) : (
          <>
            {view && <Highlights rows={view.rows} base={base} onLocate={locateRow} quoteInfo={<>{updateLabel} {fxBadges}</>} />}

            <div className="toolbar watchlist-toolbar">
              <div className="watchlist-desktop-filters">{filterControls}</div>
              <span className="spacer" />
              <input
                type="search"
                className="search"
                placeholder="Buscar valor"
                aria-label="Buscar en la lista"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="button" className="btn watchlist-filter-trigger" onClick={() => setShowFilters(true)}>
                Filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-tour="add"
                aria-label="Añadir valor"
                onClick={() => setEditing('new')}
                disabled={!listId}
              >
                Añadir<span className="watchlist-desktop-hint"> valor</span>
              </button>
            </div>
            {showFilters && (
              <Dialog title="Filtros" className="watchlist-filter-dialog" onClose={() => setShowFilters(false)} footer={(
                <>
                  <button type="button" className="btn" onClick={clearFilters} disabled={!activeFilters}>Limpiar</button>
                  <button type="button" className="btn btn--primary" onClick={() => setShowFilters(false)}>Listo</button>
                </>
              )}>
                {filterControls}
              </Dialog>
            )}

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
                  listId={listId!}
                  baseCurrency={base}
                  fx={view.fx}
                  blink={settings.blinkReached}
                  hiddenColumns={settings.hiddenColumns}
                  extraColumns={settings.extraColumns ?? []}
                  sparks={sparks.data}
                  onEdit={setEditing}
                  onTag={onTag}
                  onSaveLevel={onSaveLevel}
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
          </>
        )}
        <p className="footnote">
          Cotizaciones y consenso de analistas: Yahoo Finance (pueden tener retraso).
          {!onPortfolio && <span className="watchlist-desktop-hint"> Doble clic en una fila para editarla.</span>}
        </p>
      </main>

      {editing && listId && (
        <ItemDialog
          listId={listId}
          row={editing === 'new' ? null : editing}
          settings={view?.settings ?? settings}
          fx={view?.fx ?? {}}
          onClose={() => setEditing(null)}
          onBought={(draft) => {
            setEditing(null);
            setBuyDraft(draft);
            setPage('cartera');
          }}
        />
      )}
      {promptEl}
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
