import type {
  AlertRecord,
  Backup,
  CarteraImport,
  CarteraView,
  Instrument,
  InstrumentInput,
  InstrumentPatch,
  Operation,
  OperationInput,
  HistoryRange,
  ImportRow,
  PricePoint,
  Item,
  ItemInput,
  ItemPatch,
  Quote,
  Settings,
  SymbolSearchResult,
  WatchList,
  WatchlistView,
} from '@watchlist/shared';

export const SESSION_LOST = 'watchlist:sin-sesion';
export const AUTH_CHANGED = 'watchlist.auth-changed';

export function reloadSession() {
  localStorage.setItem(AUTH_CHANGED, crypto.randomUUID());
  window.location.replace('/');
}

export interface PushDevice {
  id: number;
  label: string | null;
  createdAt: string;
  lastOkAt: string | null;
  endpointHost: string;
}

export interface SnapshotInfo {
  id: number;
  createdAt: string;
  reason: string;
  items: number;
  operations: number;
}

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
  // Sesión caducada o cerrada en otro sitio: la app vuelve a la pantalla de entrada.
  if (res.status === 401 && !url.startsWith('/api/login')) window.dispatchEvent(new Event(SESSION_LOST));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`, data.issues);
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>('GET', '/api/health'),
  session: () => request<{
    authRequired: boolean; authenticated: boolean; googleEnabled: boolean; registrationEnabled: boolean;
    user: { id: string; email: string; googleLinked: boolean } | null;
  }>('GET', '/api/session'),
  login: (email: string, password: string) => request<{ ok: true }>('POST', '/api/login', { email, password }),
  register: (email: string, password: string) => request<{ ok: true }>('POST', '/api/register', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout', {}),

  pushKey: () => request<{ publicKey: string | null; enabled: boolean }>('GET', '/api/push/key'),
  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string) =>
    request<{ ok: true }>('POST', '/api/push/subscribe', { subscription, label }),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/api/push/unsubscribe', { endpoint }),
  pushDevices: () => request<PushDevice[]>('GET', '/api/push/devices'),
  removeDevice: (id: number) => request<void>('DELETE', `/api/push/devices/${id}`),
  pushTest: () => request<{ sent: number; failed: number }>('POST', '/api/push/test', {}),
  checkAlerts: () => request<{ alerts: number }>('POST', '/api/alerts/check', {}),

  snapshots: () => request<SnapshotInfo[]>('GET', '/api/snapshots'),
  restoreSnapshot: (id: number) =>
    request<{ lists: number; items: number; operations: number; savedTo: string | null }>('POST', `/api/snapshots/${id}/restore`, {}),

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

  portfolio: (force = false) => request<CarteraView>('GET', `/api/portfolio${force ? '?force=1' : ''}`),
  createOperation: (operation: OperationInput, instrument?: Partial<InstrumentInput>) =>
    request<Operation>('POST', '/api/operations', { operation, instrument }),
  updateOperation: (id: number, data: OperationInput) => request<Operation>('PUT', `/api/operations/${id}`, data),
  deleteOperation: (id: number) => request<void>('DELETE', `/api/operations/${id}`),
  setBroker: (ids: number[], broker: string | null, needsReview = false) =>
    request<{ updated: number }>('POST', '/api/operations/broker', { ids, broker, needsReview }),
  updateInstrument: (ticker: string, patch: InstrumentPatch) =>
    request<Instrument>('PUT', `/api/instruments/${encodeURIComponent(ticker)}`, patch),
  importCartera: (data: CarteraImport) =>
    request<{ imported: number; replaced: number; savedTo: number | null }>('POST', '/api/portfolio/import', data),

  search: (q: string) => request<SymbolSearchResult[]>('GET', `/api/market/search?q=${encodeURIComponent(q)}`),
  fx: (currencies: string[]) =>
    request<Record<string, number>>('GET', `/api/market/fx?currencies=${encodeURIComponent(currencies.join(','))}`),
  quotes: (symbols: string[]) => request<Quote[]>('GET', `/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  importRows: (listId: number, items: ImportRow[]) =>
    request<{ created: number; updated: number }>('POST', `/api/lists/${listId}/import`, { items }),
  quote: (symbol: string) => request<Quote>('GET', `/api/market/quote/${encodeURIComponent(symbol)}`),
  history: (symbol: string, range: HistoryRange) =>
    request<{ points: PricePoint[]; stale: boolean }>('GET', `/api/market/history/${encodeURIComponent(symbol)}?range=${range}`),
  sparklines: (symbols: string[], range: '3m' | '1y' = '3m') =>
    request<Record<string, number[]>>(
      'GET',
      `/api/market/sparklines?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`,
    ),

  alerts: () => request<AlertRecord[]>('GET', '/api/alerts'),
  importBackup: (data: Backup) =>
    request<{ lists: number; items: number; operations: number; savedTo: string | null }>('POST', '/api/backup', data),
};
