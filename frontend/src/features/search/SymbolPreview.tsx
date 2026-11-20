import { computeMetrics, itemInputSchema, localToday, type Item, type Settings, type WatchlistRow } from '@/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { ApiError, api } from '../../api/client.ts';
import { Icon } from '../../components/Icon.tsx';
import { useMenuPopover } from '../../components/useMenuPopover.ts';
import { useRecentSymbols } from '../../lib/recentSymbols.ts';
import { TickerRail, type RailItem } from '../watchlist/TickerRail.tsx';
import { ValueExpanded } from '../watchlist/ValueExpanded.tsx';

export interface PreviewPick {
  symbol: string;
  name?: string | null;
  isin?: string | null;
}

/**
 * Ficha de un valor buscado desde la cabecera, igual que el detalle de la lista: precio, mapa,
 * gráficos y datos. Si no está en la lista se monta una fila «de mentira» sin precios de compra,
 * que no se guarda hasta pulsar «Añadir».
 */
type ListOption = { id: number; name: string; itemCount: number };

export function SymbolPreview({ pick, existing, settings, lists, listId, onAdd, onNewList, onEdit, onPick, onClose }: {
  pick: PreviewPick;
  /** La fila de la lista abierta, si el valor ya está en ella. */
  existing?: WatchlistRow;
  settings: Settings;
  lists: ListOption[];
  /** Lista abierta: es la del botón principal «Añadir a…». */
  listId: number | null;
  onAdd: (listId: number) => void;
  onNewList: () => void;
  onEdit?: (row: WatchlistRow) => void;
  /** Abre otro valor de los buscados recientemente (carril de la izquierda). */
  onPick: (pick: PreviewPick) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    if (!el.open) el.showModal();
    return () => el.close();
  }, []);

  const symbol = pick.symbol.toUpperCase();
  const quoteQ = useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => api.quote(symbol),
    enabled: !existing,
    retry: false,
    staleTime: 60_000,
    refetchInterval: settings.refreshSeconds * 1000,
  });
  const quote = quoteQ.data;
  const targetsQ = useQuery({
    queryKey: ['targets', symbol],
    queryFn: () => api.targets(symbol),
    enabled: !existing && !!quote,
    staleTime: 60 * 60_000,
  });
  const cur = quote?.currency;
  const fxQ = useQuery({
    queryKey: ['fx', cur],
    queryFn: () => api.fx([cur!]),
    enabled: !existing && !!cur && cur !== settings.baseCurrency,
    staleTime: 5 * 60_000,
  });

  const preview = useMemo<WatchlistRow | null>(() => {
    if (existing || !quote) return null;
    const item: Item = {
      ...itemInputSchema.parse({ listId: 1, symbol }),
      name: pick.name ?? quote.name ?? null,
      isin: pick.isin ?? quote.isin ?? null,
      id: 0,
      createdAt: '',
      updatedAt: '',
    };
    const targets = targetsQ.data?.targets ?? null;
    const fxRate = !cur ? null : cur === settings.baseCurrency ? 1 : (fxQ.data?.[cur] ?? null);
    return { item, quote, targets, metrics: computeMetrics({ item, quote, targets, fxRate, settings, today: localToday() }) };
  }, [existing, quote, symbol, pick.name, pick.isin, targetsQ.data, fxQ.data, cur, settings]);

  const row = existing ?? preview;
  const label = pick.name ?? symbol;
  const current = lists.find((l) => l.id === listId) ?? lists[0];

  // Carril con los últimos valores buscados, como el de los demás valores de una lista.
  const recent = useRecentSymbols();
  const railKey = [symbol, ...recent.map((r) => r.symbol).filter((x) => x !== symbol)].join(',');
  const railSymbols = useMemo(() => railKey.split(','), [railKey]);
  const railQ = useQuery({
    queryKey: ['quotes', railKey],
    queryFn: () => api.quotes(railSymbols),
    enabled: railSymbols.length > 1,
    staleTime: 60_000,
    refetchInterval: settings.refreshSeconds * 1000,
    placeholderData: (prev) => prev,
  });
  const railItems = useMemo<RailItem[]>(() => {
    const quotes = new Map((railQ.data ?? []).map((q) => [q.symbol.toUpperCase(), q]));
    return railSymbols.map((sym) => {
      const q = sym === symbol ? (existing?.quote ?? quote ?? quotes.get(sym)) : quotes.get(sym);
      const r = recent.find((x) => x.symbol === sym);
      return {
        id: sym,
        ticker: sym.replace(/\.[A-Z]+$/, ''),
        name: r?.name ?? q?.name ?? (sym === symbol ? label : null),
        price: q?.price ?? null,
        currency: q?.currency ?? null,
        changePct: q?.changePct ?? null,
      };
    });
  }, [railQ.data, railSymbols, symbol, quote, existing, recent, label]);
  const rail =
    railItems.length > 1 ? (
      <TickerRail
        label="Buscados recientemente"
        items={railItems}
        currentId={symbol}
        onPick={(id) => {
          const r = recent.find((x) => x.symbol === id);
          onPick({ symbol: String(id), name: r?.name ?? null, isin: r?.isin ?? null });
        }}
      />
    ) : undefined;

  const menu = useMenuPopover();
  const addMenu = (
    <div {...menu.menuProps} aria-label="Añadir a la lista" className="list-menu">
      {lists.map((l) => (
        <button key={l.id} type="button" role="menuitem" className="list-menu__item" onClick={() => menu.pick(() => onAdd(l.id))}>
          <span className="list-menu__check">{l.id === current?.id && <Icon name="check" size={14} />}</span>
          <span className="list-menu__name">{l.name}</span>
          <span className="list-menu__count">{l.itemCount}</span>
        </button>
      ))}
      <hr className="list-menu__sep" />
      <button type="button" role="menuitem" className="list-menu__item list-menu__item--new" onClick={() => menu.pick(onNewList)}>
        <span className="list-menu__check"><Icon name="plus" size={14} /></span>
        <span className="list-menu__name">Nueva lista…</span>
      </button>
    </div>
  );
  const actions = existing ? (
    <>
      <span className="pill preview__in-list">En {current?.name ?? 'tu lista'}</span>
      <button ref={menu.btn} type="button" className="btn preview__add" popoverTarget={menu.id} aria-haspopup="menu">
        <Icon name="plus" size={16} /> Otra lista <Icon name="chevron" size={14} />
      </button>
      {addMenu}
    </>
  ) : (
    <>
      <span ref={menu.anchor} className="preview__split">
        <button type="button" className="btn btn--primary preview__add" onClick={() => (current ? onAdd(current.id) : onNewList())}>
          <Icon name="plus" size={16} />
          {current ? `Añadir a ${current.name}` : 'Nueva lista'}
        </button>
        <button
          ref={menu.btn}
          type="button"
          className="btn btn--primary preview__add-more"
          popoverTarget={menu.id}
          aria-haspopup="menu"
          aria-label="Añadir a otra lista"
          title="Añadir a otra lista"
        >
          <Icon name="chevron" size={16} />
        </button>
      </span>
      {addMenu}
    </>
  );

  return (
    <dialog
      ref={ref}
      className="dialog dialog--preview"
      aria-label={`Ficha de ${label}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {row ? (
        <ValueExpanded
          key={symbol}
          row={row}
          rail={rail}
          base={settings.baseCurrency}
          onClose={onClose}
          onEdit={existing && onEdit ? () => onEdit(existing) : undefined}
          actions={actions}
        />
      ) : (
        <div className="preview__state">
          <header className="preview__state-head">
            <strong>{label}</strong>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar">×</button>
          </header>
          {quoteQ.isError ? (
            <p className="error-box" role="alert">
              {quoteQ.error instanceof ApiError && quoteQ.error.status === 404
                ? `No hay cotización para ${symbol}. Prueba con otra bolsa del mismo valor.`
                : 'No se pudo cargar la cotización. Inténtalo de nuevo en un momento.'}
            </p>
          ) : (
            <p className="preview__loading" role="status">
              <span className="combo__spinner" aria-hidden /> Cargando {symbol}…
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
