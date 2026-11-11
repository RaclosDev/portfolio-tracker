import type { InstrumentInput, InstrumentPatch, ItemInput, ItemPatch, OperationInput, Settings } from '@watchlist/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.ts';

export const keys = {
  settings: ['settings'] as const,
  lists: ['lists'] as const,
  watchlist: (id: number) => ['watchlist', id] as const,
  portfolio: ['portfolio'] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useLists = () => useQuery({ queryKey: keys.lists, queryFn: api.lists });

export function useWatchlist(listId: number | null, refreshSeconds: number) {
  return useQuery({
    queryKey: keys.watchlist(listId ?? 0),
    queryFn: () => api.watchlist(listId!),
    enabled: listId != null,
    refetchInterval: refreshSeconds * 1000,
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

export function usePortfolio(refreshSeconds: number, enabled = true) {
  return useQuery({
    queryKey: keys.portfolio,
    queryFn: () => api.portfolio(),
    enabled,
    refetchInterval: refreshSeconds * 1000,
    placeholderData: keepPreviousData,
  });
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

/** Minigráficos de 1 año de los valores en cartera. */
export function useSparklines1y(symbols: string[]) {
  return useQuery({
    queryKey: ['sparklines-1y', symbols.join(',')],
    queryFn: () => api.sparklines(symbols, '1y'),
    enabled: symbols.length > 0,
    staleTime: 30 * 60_000,
  });
}
