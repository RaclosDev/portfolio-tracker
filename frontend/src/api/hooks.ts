import type { InstrumentInput, InstrumentPatch, ItemInput, ItemPatch, OperationInput, Settings } from '@/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './client.ts';

export const keys = {
  settings: ['settings'] as const,
  lists: ['lists'] as const,
  watchlist: (id: number) => ['watchlist', id] as const,
  portfolio: ['portfolio'] as const,
  visited: ['visited'] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useLists = () => useQuery({ queryKey: keys.lists, queryFn: api.lists });

/** Cada cuánto se piden los precios de lo que está en pantalla (lista o cartera), como el gráfico abierto. */
export const LIVE_REFRESH_MS = 2_000;

/**
 * Lista en pantalla: con `live`, precios cada dos segundos (se pausa con la pestaña en segundo plano);
 * si no, cada `refreshSeconds`.
 */
export function useWatchlist(listId: number | null, refreshSeconds: number, live = false) {
  return useQuery({
    queryKey: keys.watchlist(listId ?? 0),
    queryFn: () => api.watchlist(listId!, false, live),
    enabled: listId != null,
    refetchInterval: live ? LIVE_REFRESH_MS : refreshSeconds * 1000,
    placeholderData: keepPreviousData,
  });
}

/** Invalida todo lo que depende de los valores guardados. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useForceRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listId: number) => api.watchlist(listId, true),
    onSuccess: (data, listId) => qc.setQueryData(keys.watchlist(listId), data),
  });
}

export function useSaveItem() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: ItemInput | ItemPatch }) =>
      id ? api.updateItem(id, data) : api.createItem(data as ItemInput),
    onSuccess: invalidate,
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.deleteItem, onSuccess: invalidate });
}

export function useUpdateSettings() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (p: Partial<Settings>) => api.updateSettings(p), onSuccess: invalidate });
}

export function useListMutations() {
  const invalidate = useInvalidateAll();
  return {
    create: useMutation({ mutationFn: api.createList, onSuccess: invalidate }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: number; name: string }) => api.renameList(id, name),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteList, onSuccess: invalidate }),
  };
}

export function useImportBackup() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.importBackup, onSuccess: invalidate });
}

/**
 * Cartera. Con `live`, sus precios cada dos segundos sin volver a traer operaciones ni instrumentos (eran
 * 166 kB de JSON cada vez): se mezclan sobre la última cartera completa, que se pide cada `refreshSeconds`.
 */
export function usePortfolio(refreshSeconds: number, enabled = true, live = false) {
  const full = useQuery({
    queryKey: keys.portfolio,
    queryFn: () => api.portfolio(),
    enabled,
    refetchInterval: refreshSeconds * 1000,
    placeholderData: keepPreviousData,
  });
  const prices = useQuery({
    queryKey: [...keys.portfolio, 'quotes'],
    queryFn: api.portfolioQuotes,
    enabled: enabled && live && full.data != null,
    refetchInterval: LIVE_REFRESH_MS,
  });
  const data = useMemo(
    () => full.data && prices.data && prices.dataUpdatedAt > full.dataUpdatedAt ? { ...full.data, ...prices.data } : full.data,
    [full.data, full.dataUpdatedAt, prices.data, prices.dataUpdatedAt],
  );
  return data === full.data ? full : { ...full, data };
}

export function useOperationMutations() {
  const invalidate = useInvalidateAll();
  return {
    save: useMutation({
      mutationFn: ({ id, data, instrument }: { id?: number; data: OperationInput; instrument?: Partial<InstrumentInput> }) =>
        id ? api.updateOperation(id, data, instrument) : api.createOperation(data, instrument),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteOperation, onSuccess: invalidate }),
    setBroker: useMutation({
      mutationFn: ({ ids, broker, needsReview }: { ids: number[]; broker: string | null; needsReview?: boolean }) =>
        api.setBroker(ids, broker, needsReview),
      onSuccess: invalidate,
    }),
    updateInstrument: useMutation({
      mutationFn: ({ ticker, patch }: { ticker: string; patch: InstrumentPatch }) => api.updateInstrument(ticker, patch),
      onSuccess: invalidate,
    }),
    importCartera: useMutation({ mutationFn: api.importCartera, onSuccess: invalidate }),
  };
}

/** Mayores posiciones de cada fondo o ETF en cartera. Cambian poco: el servidor las guarda una semana. */
export function usePortfolioComposition(enabled = true) {
  return useQuery({
    queryKey: ['portfolio-composition'],
    queryFn: api.portfolioComposition,
    enabled,
    staleTime: 60 * 60_000,
  });
}

/** Minigráficos de 1 año de los valores en cartera. */
export function useSparklines1y(symbols: string[]) {
  return useQuery({
    queryKey: ['sparklines-1y', symbols.join(',')],
    queryFn: () => api.sparklines(symbols, '1y'),
    enabled: symbols.length > 0,
    staleTime: 30 * 60_000,
  });
}
