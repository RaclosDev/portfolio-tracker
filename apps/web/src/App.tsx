import { DEFAULT_SETTINGS, type PortfolioRow, type WatchlistRow } from '@watchlist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api/client.ts';
import { keys, useForceRefresh, useListMutations, useLists, usePortfolio, useSaveItem, useSettings, useWatchlist } from './api/hooks.ts';
import { PortfolioPage } from './features/portfolio/PortfolioPage.tsx';
import { PositionDialog, type PositionDraft } from './features/portfolio/PositionDialog.tsx';
import { TradeDialog } from './features/portfolio/TradeDialog.tsx';
import { DetailPanel } from './features/detail/DetailPanel.tsx';
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
  const [posEditing, setPosEditing] = useState<PortfolioRow | 'new' | null>(null);
  const [posDraft, setPosDraft] = useState<PositionDraft | undefined>();
  const [trading, setTrading] = useState<{ row: PortfolioRow; type: 'buy' | 'sell' } | null>(null);
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
  const [detailId, setDetailId] = useState<number | null>(null);

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
  const detailRow = view?.rows.find((r) => r.item.id === detailId) ?? null;
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
  const fxChips = Object.entries((onPortfolio ? pf.data?.fx : view?.fx) ?? {}).filter(([c]) => c !== base && /^[A-Z]{3}$/.test(c));
  const anyStale = onPortfolio ? pf.data?.rows.some((r) => r.quote?.stale) : view?.rows.some((r) => r.quote?.stale);
  const fetching = onPortfolio ? pf.isFetching || pfRefreshing : wl.isFetching || refresh.isPending;
  const generatedAt = onPortfolio ? pf.data?.generatedAt : view?.generatedAt;
  const throttledUntil = onPortfolio ? pf.data?.throttledUntil : view?.throttledUntil;

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
          <button
            type="button"
            className="tab tab--add"
            title="Nueva lista"
            onClick={async () => {
              const name = await ask('Nueva lista', 'Nombre de la lista');
              if (name) {
                setListId((await createList.mutateAsync(name)).id);
                setPage('lista');
              }
            }}
          >
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
            {pf.data && <span className="tab__count">{pf.data.rows.length}</span>}
          </button>
        </nav>

        <div className="topbar__right">
          {fxChips.map(([c, r]) => (
            <span key={c} className="chip" title={`1 ${base} = ${r} ${c}`}>
              {base}/{c} <strong>{num(r, 4)}</strong>
            </span>
          ))}
          <span className={`updated${anyStale ? ' updated--stale' : ''}`} aria-live="polite">
            {fetching
              ? 'Actualizando…'
              : anyStale
                ? 'Sin conexión: datos guardados'
                : `Actualizado ${timeAgo(generatedAt, now)}`}
          </span>
          <button
            type="button"
            className="btn"
            data-tour="refresh"
            onClick={() => (onPortfolio ? void refreshPortfolio() : listId && refresh.mutate(listId))}
            disabled={onPortfolio ? pfRefreshing : !listId || refresh.isPending}
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
        <PushBanner />
        {throttledUntil && (
          <p className="notice" role="status">
            Yahoo está limitando las consultas. Se muestran los últimos precios guardados y se vuelve a intentar a las{' '}
            {new Date(throttledUntil).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        )}
        {onPortfolio ? (
          <PortfolioPage
            view={pf.data}
            isPending={pf.isPending}
            error={pf.error}
            base={base}
            onAdd={() => {
              setPosDraft(undefined);
              setPosEditing('new');
            }}
            onEdit={setPosEditing}
            onTrade={(row, type) => setTrading({ row, type })}
          />
        ) : (
          <>
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
                  listId={listId!}
                  baseCurrency={base}
                  blink={settings.blinkReached}
                  hiddenColumns={settings.hiddenColumns}
                  extraColumns={settings.extraColumns ?? []}
                  sparks={sparks.data}
                  onEdit={setEditing}
                  onOpen={(r) => setDetailId(r.item.id)}
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
          onBought={(draft) => {
            setEditing(null);
            setPosDraft(draft);
            setPosEditing('new');
            setPage('cartera');
          }}
        />
      )}
      {posEditing && (
        <PositionDialog
          row={posEditing === 'new' ? null : posEditing}
          draft={posEditing === 'new' ? posDraft : undefined}
          base={base}
          onClose={() => setPosEditing(null)}
        />
      )}
      {trading && <TradeDialog row={trading.row} type={trading.type} base={base} onClose={() => setTrading(null)} />}
      {promptEl}
      {tourOpen && <Tour steps={TOUR_STEPS} onClose={closeTour} />}
      {showSettings && <SettingsDialog settings={settings} lists={lists} onClose={() => setShowSettings(false)} />}
      {showAlerts && (
        <AlertsDialog
          itemIds={new Map((view?.rows ?? []).map((r) => [r.item.symbol, r.item.id]))}
          onClose={() => setShowAlerts(false)}
        />
      )}
      {detailRow && (
        <DetailPanel
          row={detailRow}
          base={base}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditing(detailRow);
          }}
        />
      )}
    </div>
  );
}
