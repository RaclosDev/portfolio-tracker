import type { ItemInput, ItemPatch, PositionInput, PositionPatch, Settings } from '@watchlist/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Trade } from './client.ts';

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

export function usePositionMutations() {
  const invalidate = useInvalidateAll();
  return {
    save: useMutation({
      mutationFn: ({ id, data }: { id?: number; data: PositionInput | PositionPatch }) =>
        id ? api.updatePosition(id, data) : api.createPosition(data as PositionInput),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deletePosition, onSuccess: invalidate }),
    trade: useMutation({ mutationFn: ({ id, t }: { id: number; t: Trade }) => api.trade(id, t), onSuccess: invalidate }),
  };
}
