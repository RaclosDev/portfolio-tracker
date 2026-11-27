import { DEFAULT_SETTINGS, displayTicker, VISITED_LIST_ID, VISITED_LIST_NAME, type Item, type TouchedOrder, type WatchlistRow } from '@/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, DEMO } from './api/client.ts';
import { EMBED } from './demo/embed.ts';
import { LS_LIST, LS_PAGE } from './api/bootstrap.ts';
import { keys, useForceRefresh, useListMutations, useLists, usePortfolio, useSaveItem, useSettings, useWatchlist } from './api/hooks.ts';
import type { OperationDraft } from './features/cartera/OperationDialog.tsx';
import { useCarteraModel } from './features/cartera/model.ts';
import { Highlights, goToRow } from './features/watchlist/Highlights.tsx';
import { Dialog } from './components/Dialog.tsx';
import { toastError } from './components/feedback.tsx';
import { StatusFilter, filterRow, type Filter } from './features/watchlist/StatusFilter.tsx';
import { WatchlistTable, type Tag } from './features/watchlist/WatchlistTable.tsx';
import { activeFilterCount } from './features/watchlist/filterState.ts';
import { TagFilters, filterMarket, rowType, type MarketFilter, type TypeFilter } from './features/watchlist/TagFilters.tsx';
import { num, timeAgo } from './lib/format.ts';
import { applyAppearance, applyColors } from './lib/theme.ts';
import { usePrompt } from './components/usePrompt.tsx';
import { Icon } from './components/Icon.tsx';
import { ListMenu } from './components/ListMenu.tsx';
import { PushBanner } from './components/PushBanner.tsx';
import { QuoteSources } from './components/QuoteSources.tsx';
import { HighlightsSkeleton, PortfolioSkeleton, TableSkeleton } from './components/Skeleton.tsx';
import { SyncStatus } from './components/SyncStatus.tsx';
import { LevelsAfterBuy, TouchedOrdersButton, touchedDraft, touchedKey, useTouchedOrders } from './components/TouchedOrders.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { SymbolPicker } from './features/items/SymbolPicker.tsx';
import { boughtDraft } from './features/items/boughtDraft.ts';
import type { PreviewPick } from './features/search/SymbolPreview.tsx';
import { useRecentSymbols, useRememberSymbol } from './lib/recentSymbols.ts';

// Lo que no hace falta para pintar la lista va en trozos aparte, que se descargan al usarlos.
const loadCartera = () => import('./features/cartera/CarteraPage.tsx').then((m) => ({ default: m.CarteraPage }));
const CarteraPage = lazy(loadCartera);
const ItemDialog = lazy(() => import('./features/items/ItemDialog.tsx').then((m) => ({ default: m.ItemDialog })));
const SettingsDialog = lazy(() => import('./features/settings/SettingsDialog.tsx').then((m) => ({ default: m.SettingsDialog })));
const AlertsDialog = lazy(() => import('./features/alerts/AlertsDialog.tsx').then((m) => ({ default: m.AlertsDialog })));
const SymbolPreview = lazy(() => import('./features/search/SymbolPreview.tsx').then((m) => ({ default: m.SymbolPreview })));
const AppTour = lazy(() => import('./features/tour/AppTour.tsx'));

const LS_TOUR = 'watchlist.tourSeen';
const LS_CARTERA_TOUR = 'watchlist.cartera.tourSeen';
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
  const lists = useMemo(() => listsQ.data ?? [], [listsQ.data]);

  const [listId, setListId] = useState<number | null>(() => Number(localStorage.getItem(LS_LIST)) || null);
  const isVisited = listId === VISITED_LIST_ID;
  const recent = useRecentSymbols();
  const rememberSymbol = useRememberSymbol();
  const visitedList = useMemo(() => ({ id: VISITED_LIST_ID, name: VISITED_LIST_NAME, itemCount: recent.length }), [recent.length]);
  /** Las listas del selector: las propias y, aparte, «Visitados». */
  const menuLists = useMemo(() => [...lists, visitedList], [lists, visitedList]);
  useEffect(() => {
    if (lists.length && listId !== VISITED_LIST_ID && !lists.some((l) => l.id === listId)) setListId(lists[0]!.id);
  }, [lists, listId]);
  useEffect(() => {
    if (listId) localStorage.setItem(LS_LIST, String(listId));
  }, [listId]);

  useEffect(() => applyColors(settings.colors), [settings.colors]);
  useEffect(() => applyAppearance(settings), [settings.skin, settings.theme, settings.appIcon, settings.density, settings.fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Página visible: una lista de vigilancia o la cartera real.
  const [page, setPage] = useState<Page>(() => (localStorage.getItem(LS_PAGE) === 'cartera' ? 'cartera' : 'lista'));
  useEffect(() => localStorage.setItem(LS_PAGE, page), [page]);
  const onPortfolio = page === 'cartera';
  // La cartera es el destino más probable: su trozo se descarga solo, poco después de arrancar.
  useEffect(() => {
    const id = window.setTimeout(() => void loadCartera(), 2000);
    return () => window.clearTimeout(id);
  }, []);

  // Precios casi en directo solo de la pantalla abierta: la lista en «Vigilar», la cartera en «Cartera».
  const wl = useWatchlist(listId, settings.refreshSeconds, !onPortfolio);
  // La cartera se refresca al ritmo normal solo cuando se está viendo; si no, cada 5 min (para el contador).
  const pf = usePortfolio(onPortfolio ? settings.refreshSeconds : 300, true, onPortfolio);
  const carteraModel = useCarteraModel(pf.data);
  const refresh = useForceRefresh();
  const qc = useQueryClient();
  const [pfRefreshing, setPfRefreshing] = useState(false);
  const refreshPortfolio = async () => {
    setPfRefreshing(true);
    try {
      qc.setQueryData(keys.portfolio, await api.portfolio(true));
    } catch (e) {
      toastError('No se pudieron actualizar las cotizaciones.')(e);
    } finally {
      setPfRefreshing(false);
    }
  };
  const [buyDraft, setBuyDraft] = useState<OperationDraft | null>(null);
  const clearDraft = useCallback(() => setBuyDraft(null), []);
  /** Tras apuntar la compra de una orden tocada: proponer cómo quedan los precios de compra. */
  const [levelsAfter, setLevelsAfter] = useState<{ item: Item; bought: number; currency: string } | null>(null);
  const reviewTouched = (o: TouchedOrder) => {
    setBuyDraft({
      ...touchedDraft(o),
      onSaved: () => {
        // La orden ya está en la cartera: se quita de la ficha y de la lista de tocadas.
        void (async () => {
          try {
            const item = await api.updateItem(o.itemId, { orderActive: false, orderPrice: null, orderUntil: null });
            await api.dismissTouchedOrder(o.itemId).catch(() => undefined);
            void qc.invalidateQueries();
            void qc.invalidateQueries({ queryKey: touchedKey });
            setLevelsAfter({ item, bought: o.orderPrice, currency: o.currency });
          } catch (e) {
            toastError('La compra se ha guardado, pero no se pudo cerrar la orden de la ficha.')(e);
          }
        })();
      },
    });
    setPage('cartera');
  };
  const { create: createList, rename: renameList } = useListMutations();
  const selectedList = isVisited ? visitedList : lists.find((list) => list.id === listId);
  const [listError, setListError] = useState<string | null>(null);
  const now = useNow(10_000);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [locateId, setLocateId] = useState<number | null>(null);
  const [editing, setEditing] = useState<WatchlistRow | 'new' | null>(null);
  /** Buscador de la cabecera: texto escrito y valor abierto en la ficha (esté o no en la lista). */
  const [peekQ, setPeekQ] = useState('');
  const [peek, setPeek] = useState<PreviewPick | null>(null);
  /** Valor ya elegido al añadirlo desde esa ficha. */
  const [prefill, setPrefill] = useState<PreviewPick | undefined>();
  /** Lista a la que se añade desde la ficha (puede no ser la abierta). */
  const [addTo, setAddTo] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [ask, promptEl] = usePrompt();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');

  // Los filtros se recuerdan por lista (se restauran al volver a ella o al reabrir la app).
  const filtersKey = listId ? `watchlist.filtros.${listId}` : null;
  useEffect(() => {
    if (!filtersKey) return;
    try {
      const f = JSON.parse(localStorage.getItem(filtersKey) ?? '{}') as { status?: Filter; type?: TypeFilter; currency?: string; market?: MarketFilter };
      setFilter(f.status ?? 'all');
      setTypeFilter(f.type ?? 'all');
      setCurrencyFilter(f.currency ?? 'all');
      setMarketFilter(f.market ?? 'all');
    } catch {
      /* filtros guardados no válidos: se ignoran */
    }
  }, [filtersKey]);
  useEffect(() => {
    if (filtersKey) localStorage.setItem(filtersKey, JSON.stringify({ status: filter, type: typeFilter, currency: currencyFilter, market: marketFilter }));
  }, [filtersKey, filter, typeFilter, currencyFilter, marketFilter]);

  const saveItem = useSaveItem();
  const onSaveLevel = (row: WatchlistRow, index: number, value: number | null) => {
    const next = [...row.item.buyPrices];
    if (value == null) next.splice(index, 1);
    else next[index] = value;
    saveItem.mutate({ id: row.item.id, data: { buyPrices: next } }, { onError: toastError('No se pudo guardar el precio de compra.') });
  };

  const view = wl.data;
  // Si en pantalla se ve que el precio ha llegado a una orden activa, se avisa al servidor sin esperar a su vuelta.
  const touched = useTouchedOrders(!DEMO);
  const touchKey = (view?.rows ?? [])
    .filter(({ item, quote }) => item.orderActive && item.orderPrice != null && quote && !quote.stale && quote.price != null && quote.price <= item.orderPrice)
    .filter(({ item }) => !touched.data?.some((o) => o.itemId === item.id))
    .map(({ item }) => `${item.id}@${item.orderPrice}`)
    .join(',');
  useEffect(() => {
    if (!touchKey || DEMO || !touched.isSuccess) return;
    api.checkTouchedOrders().then((list) => qc.setQueryData(touchedKey, list), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchKey]);
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
          (currencyFilter === 'all' || (r.quote?.currency ?? '') === currencyFilter) &&
          filterMarket(marketFilter)(r),
      ),
    [view, typeFilter, currencyFilter, marketFilter],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tagged
      .filter(filterRow(filter))
      .filter((r) => !q || `${r.item.symbol} ${displayTicker(r.item)} ${r.item.isin ?? r.quote?.isin ?? ''} ${r.item.name ?? ''} ${r.item.notes ?? ''}`.toLowerCase().includes(q));
  }, [tagged, filter, search]);
  const currencies = useMemo(
    () => [...new Set((view?.rows ?? []).map((r) => r.quote?.currency).filter((c): c is string => !!c))].sort(),
    [view],
  );
  const onTag = (tag: Tag) =>
    tag.kind === 'currency'
      ? setCurrencyFilter((c) => (c === tag.value ? 'all' : tag.value))
      : setTypeFilter((t) => (t === tag.value ? 'all' : tag.value));

  const activeFilters = activeFilterCount({ status: filter, type: typeFilter, currency: currencyFilter, market: marketFilter });
  const clearFilters = () => {
    setFilter('all');
    setTypeFilter('all');
    setCurrencyFilter('all');
    setMarketFilter('all');
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
      <TagFilters type={typeFilter} onType={setTypeFilter} currency={currencyFilter} currencies={currencies} onCurrency={setCurrencyFilter} market={marketFilter} onMarket={setMarketFilter} names={settings.tagNames} />
    </>
  );

  // Móvil: el buscador de la cabecera se despliega sobre ella al pulsar la lupa.
  const [searching, setSearching] = useState(false);
  const openSearch = () => {
    flushSync(() => setSearching(true)); // el foco va en el mismo toque: así el iPhone abre el teclado
    document.getElementById('buscar-cualquier-valor')?.focus();
  };
  const closeSearch = () => {
    setSearching(false);
    setPeekQ('');
  };

  // El tour se abre solo la primera vez, cuando ya hay datos que enseñar. En la demo no: se pide desde Ajustes.
  const hasTourData = onPortfolio ? (pf.data?.operations.length ?? 0) > 0 : (view?.rows.length ?? 0) > 0;
  const tourKey = onPortfolio ? LS_CARTERA_TOUR : LS_TOUR;
  useEffect(() => {
    if (!DEMO && hasTourData && !localStorage.getItem(tourKey)) setTourOpen(true);
  }, [hasTourData, tourKey]);
  const closeTour = () => {
    localStorage.setItem(tourKey, '1');
    setTourOpen(false);
  };
  const startTour = () => {
    if (!onPortfolio) {
      setFilter('all');
      setSearch('');
      setTypeFilter('all');
      setCurrencyFilter('all');
      setMarketFilter('all');
    }
    setTourOpen(true);
  };

  // Solo divisas principales: GBp (peniques) comparte tipo con GBP y no se repite.
  const fxChips = Object.entries((onPortfolio ? pf.data?.fx : view?.fx) ?? {}).filter(([c]) => c !== base && /^[A-Z]{3}$/.test(c));
  const fxStale = new Set((onPortfolio ? pf.data?.fxStale : view?.fxStale) ?? []);
  const anyStale = fxStale.size > 0 || (onPortfolio
    ? Object.values(pf.data?.quotes ?? {}).some((q) => q.stale)
    : view?.rows.some((r) => r.quote?.stale));
  const fetching = onPortfolio ? pf.isFetching || pfRefreshing : wl.isFetching || refresh.isPending;
  const generatedAt = onPortfolio ? pf.data?.generatedAt : view?.generatedAt;
  const refetchFailed = onPortfolio ? pf.isRefetchError : wl.isRefetchError;
  const shownQuotes = onPortfolio ? Object.values(pf.data?.quotes ?? {}) : (view?.rows.map((r) => r.quote) ?? []);
  const sources = fetching || refetchFailed ? null : <QuoteSources quotes={shownQuotes} />;
  // Solo la actualización pedida a mano: el refresco automático (cada 2 s) no cambia la cabecera.
  const manualRefreshing = onPortfolio ? pfRefreshing : refresh.isPending;
  const missingQuotes = onPortfolio
    ? (pf.data?.instruments ?? []).filter((i) => i.symbol && pf.data!.quotes[i.symbol]?.stale).map((i) => i.name ?? i.symbol!)
    : (view?.rows ?? []).filter((r) => !r.quote || r.quote.stale).map((r) => r.item.name ?? r.quote?.name ?? r.item.symbol);
  const updateLabel = manualRefreshing ? 'Actualizando…'
    : refetchFailed ? `Sin conexión con el servidor · precios de ${timeAgo(generatedAt, now)}`
    : anyStale ? 'Sin conexión: datos guardados'
    : `Actualizado ${timeAgo(generatedAt, now)}`;
  const fxBadges = fxChips.map(([currency, rate]) => (
    <span key={currency} className={fxStale.has(currency) ? 'chip chip--stale' : 'chip'}
      title={`1 ${base} = ${rate} ${currency}${fxStale.has(currency) ? ' · cambio guardado: la fuente no responde y la valoración en esta divisa no está al día' : ''}`}>
      {base}/{currency} <strong>{num(rate, 4)}</strong>{fxStale.has(currency) && ' ⚠'}
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

  const newList = async (): Promise<number | undefined> => {
    const name = await ask('Nueva lista', 'Nombre de la lista', '', 'Crear lista');
    if (name) {
      setListError(null);
      try {
        const { id } = await createList.mutateAsync(name);
        setListId(id);
        setPage('lista');
        return id;
      } catch {
        setListError('No se ha podido crear la lista. Vuelve a intentarlo.');
      }
    }
  };

  /** Lista propia donde se añade por defecto (en «Visitados», la primera). */
  const ownListId = isVisited ? (lists[0]?.id ?? null) : (listId ?? null);
  /** En «Visitados» no hay nada que editar: se abre la ficha, con «Añadir a…». */
  const peekRow = (row: WatchlistRow) => setPeek({ symbol: row.item.symbol, name: row.item.name, isin: row.item.isin });

  const addFromPreview = (to: number) => {
    setPrefill(peek ?? undefined);
    setAddTo(to);
    setPeek(null);
    setEditing('new');
  };

  const openList = (id: number) => {
    setListId(id);
    setPage('lista');
  };

  const renameCurrentList = async () => {
    if (!selectedList || isVisited) return;
    const name = await ask('Renombrar lista', 'Nuevo nombre', selectedList.name, 'Renombrar');
    if (!name || name === selectedList.name) return;
    setListError(null);
    try {
      await renameList.mutateAsync({ id: selectedList.id, name });
    } catch {
      setListError('No se ha podido cambiar el nombre de la lista. Vuelve a intentarlo.');
    }
  };

  return (
    <div className="app">
      {DEMO && !EMBED && (
        <p className="demo-banner" role="status">
          <strong>Modo demo.</strong> <span className="demo-banner__detail">Datos ficticios: los cambios se pierden al recargar.</span>
          <a href="/">Salir y crear una cuenta</a>
        </p>
      )}
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className={`topbar${searching ? ' topbar--searching' : ''}`} onKeyDown={(e) => e.key === 'Escape' && searching && closeSearch()}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <h1>Portfolio Tracker</h1>
        </div>

        <nav className="tabs" aria-label="Listas">
          {lists.length > 0 ? (
            <ListMenu
              variant="tab"
              onRename={() => void renameCurrentList()}
              lists={menuLists}
              currentId={listId ?? null}
              active={!onPortfolio}
              creating={createList.isPending}
              onSelect={openList}
              onNew={newList}
            />
          ) : lists.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`tab tab--list${!onPortfolio && l.id === listId ? ' tab--active' : ''}`}
              title={`${l.name} · doble clic para renombrar`}
              aria-current={!onPortfolio && l.id === listId ? 'page' : undefined}
              onClick={() => {
                setListId(l.id);
                setPage('lista');
              }}
              onDoubleClick={() => l.id === listId && void renameCurrentList()}
            >
              <span className="tab__name">{l.name}</span>
              <span className="tab__count">{l.itemCount}</span>
            </button>
          ))}
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

        <div className="topbar__search" role="search">
          <SymbolPicker
            inputId="buscar-cualquier-valor"
            className="combo--topbar"
            placeholder="Buscar cualquier valor…"
            value={peekQ}
            onChange={setPeekQ}
            recent={recent}
            onPick={(r) => {
              rememberSymbol(r);
              setPeek({ symbol: r.symbol, name: r.name, isin: r.isin ?? null });
              setPeekQ('');
              setSearching(false);
            }}
          />
          <button type="button" className="icon-btn topbar__search-close" aria-label="Cerrar el buscador" onClick={closeSearch}>✕</button>
        </div>

        <div className="topbar__right">
          <button type="button" className="btn btn--ghost btn--icon topbar__search-toggle" aria-label="Buscar cualquier valor" title="Buscar cualquier valor" onClick={openSearch}>
            <span className="btn__icon">
              <Icon name="search" size={20} />
            </span>
          </button>
          {fxBadges}
          {(anyStale || refetchFailed) && <span className="updated updated--stale" aria-live="polite">{updateLabel}</span>}
          <SyncStatus
            label={updateLabel}
            tone={anyStale || refetchFailed ? 'stale' : 'ok'}
            quotes={shownQuotes}
            missing={missingQuotes}
            spinning={manualRefreshing}
            disabled={onPortfolio ? pfRefreshing : !listId || refresh.isPending}
            onRefresh={() => (onPortfolio ? void refreshPortfolio() : listId && refresh.mutate(listId, { onError: toastError('No se pudieron actualizar las cotizaciones.') }))}
          />
          {!DEMO && <TouchedOrdersButton onReview={reviewTouched} />}
          <button type="button" className="btn btn--ghost btn--icon" data-tour="alerts" aria-label="Avisos" title="Avisos" onClick={() => setShowAlerts(true)}>
            <span className="btn__icon">
              <Icon name="bell" size={20} />
            </span>
          </button>
          <button type="button" className="btn btn--ghost" data-tour="settings" aria-label="Ajustes" title="Ajustes" onClick={() => setShowSettings(true)}>
            <span className="btn__icon">
              <Icon name="gear" size={20} />
            </span>
            <span className="btn__label">Ajustes</span>
          </button>
        </div>
      </header>

      <main className="content" id="contenido" tabIndex={-1}>
        <UpdateBanner />
        {!EMBED && <PushBanner />}
        {listError && <p className="error-box" role="alert">{listError}</p>}
        {throttleMin != null && (
          <p className="notice" role="status">
            La fuente de precios ha pedido ir más despacio. Mientras tanto ves los últimos precios guardados; se vuelve a consultar en{' '}
            {throttleMin} min.
          </p>
        )}
        {onPortfolio ? (
          <Suspense fallback={<PortfolioSkeleton />}>
            <CarteraPage
              model={carteraModel}
              isPending={pf.isPending}
              error={pf.error}
              onRetry={() => void pf.refetch()}
              draft={buyDraft}
              onDraftUsed={clearDraft}
            />
          </Suspense>
        ) : (
          <>
            {view ? <Highlights rows={view.rows} base={base} onLocate={locateRow} quoteInfo={<>{updateLabel} {sources} {fxBadges}</>} />
              : wl.isPending && listId ? <HighlightsSkeleton /> : null}

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
              {!isVisited && <button
                type="button"
                className="btn btn--primary"
                data-tour="add"
                aria-label="Añadir valor"
                onClick={() => setEditing('new')}
                disabled={!listId}
              >
                Añadir<span className="watchlist-desktop-hint"> valor</span>
              </button>}
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

            {wl.isError && (
              <div className="error-box" role="alert">
                No se pudo cargar la lista: {(wl.error as Error).message}{' '}
                <button type="button" className="btn" onClick={() => void wl.refetch()}>Reintentar</button>
              </div>
            )}
            {wl.isPending && listId && <TableSkeleton rows={8} cols={6} label="Cargando cotizaciones…" />}
            {view && view.rows.length === 0 && isVisited && (
              <div className="empty">
                <p>Aquí irán los valores que abras desde «Buscar cualquier valor…».</p>
              </div>
            )}
            {view && view.rows.length === 0 && !isVisited && (
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
                  blink={settings.blinkReached}
                  hiddenColumns={settings.hiddenColumns}
                  extraColumns={settings.extraColumns ?? []}
                  sparks={sparks.data}
                  onEdit={isVisited ? peekRow : setEditing}
                  onBought={isVisited ? undefined : (row) => {
                    setBuyDraft(boughtDraft(row));
                    setPage('cartera');
                  }}
                  onTag={onTag}
                  onSaveLevel={isVisited ? peekRow : onSaveLevel}
                  holdings={isVisited ? undefined : carteraModel?.valuation.open}
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
          </>
        )}
      </main>

      {promptEl}
      <Suspense fallback={null}>
        {editing && (addTo ?? ownListId) && (
          <ItemDialog
            listId={(addTo ?? ownListId)!}
            row={editing === 'new' ? null : editing}
            settings={view?.settings ?? settings}
            fx={view?.fx ?? {}}
            prefill={editing === 'new' ? prefill : undefined}
            onClose={() => {
              setEditing(null);
              setPrefill(undefined);
              setAddTo(null);
            }}
            onBought={(draft) => {
              setEditing(null);
              setPrefill(undefined);
              setAddTo(null);
              setBuyDraft(draft);
              setPage('cartera');
            }}
          />
        )}
        {levelsAfter && <LevelsAfterBuy {...levelsAfter} onClose={() => setLevelsAfter(null)} />}
        {peek && (
          <SymbolPreview
            pick={peek}
            existing={isVisited ? undefined : view?.rows.find((r) => r.item.symbol === peek.symbol.toUpperCase())}
            settings={view?.settings ?? settings}
            lists={lists}
            listId={ownListId}
            onAdd={addFromPreview}
            onNewList={() => void newList().then((id) => id && addFromPreview(id))}
            onPick={setPeek}
            onEdit={(row) => {
              setPeek(null);
              setEditing(row);
            }}
            onClose={() => setPeek(null)}
          />
        )}
        {tourOpen && <AppTour key={page} portfolio={onPortfolio} onClose={closeTour} />}
        {showSettings && (
          <SettingsDialog
            settings={settings}
            lists={lists}
            onClose={() => setShowSettings(false)}
            onStartTour={() => {
              setShowSettings(false);
              startTour();
            }}
          />
        )}
        {showAlerts && (
          <AlertsDialog
            itemIds={new Map((view?.rows ?? []).map((r) => [r.item.symbol, r.item.id]))}
            onClose={() => setShowAlerts(false)}
          />
        )}
      </Suspense>
    </div>
  );
}
