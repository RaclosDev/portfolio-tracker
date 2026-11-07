import type {
  AlertRecord,
  Backup,
  Item,
  ItemInput,
  ItemPatch,
  Quote,
  Settings,
  SymbolSearchResult,
  WatchList,
  WatchlistView,
} from '@watchlist/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`, data.issues);
  return data as T;
}

export const api = {
  settings: () => request<Settings>('GET', '/api/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', patch),

  lists: () => request<WatchList[]>('GET', '/api/lists'),
  createList: (name: string) => request<WatchList>('POST', '/api/lists', { name }),
  renameList: (id: number, name: string) => request<WatchList>('PATCH', `/api/lists/${id}`, { name }),
  deleteList: (id: number) => request<void>('DELETE', `/api/lists/${id}`),
  watchlist: (id: number, force = false) =>
    request<WatchlistView>('GET', `/api/lists/${id}/watchlist${force ? '?force=1' : ''}`),

  createItem: (data: ItemInput) => request<Item>('POST', '/api/items', data),
  updateItem: (id: number, patch: ItemPatch) => request<Item>('PATCH', `/api/items/${id}`, patch),
  deleteItem: (id: number) => request<void>('DELETE', `/api/items/${id}`),

  search: (q: string) => request<SymbolSearchResult[]>('GET', `/api/market/search?q=${encodeURIComponent(q)}`),
  fx: (currencies: string[]) =>
    request<Record<string, number>>('GET', `/api/market/fx?currencies=${encodeURIComponent(currencies.join(','))}`),
  quote: (symbol: string) => request<Quote>('GET', `/api/market/quote/${encodeURIComponent(symbol)}`),

  alerts: () => request<AlertRecord[]>('GET', '/api/alerts'),
  importBackup: (data: Backup) => request<{ lists: number; items: number; savedTo: string | null }>('POST', '/api/backup', data),
};
