import { VISITED_LIST_ID } from '@/shared';
import type {
  TouchedOrder,
  AlertRecord,
  AnalystTargets,
  Backup,
  Candle,
  IntradayInterval,
  ChartDrawing,
  CarteraImport,
  CarteraView,
  PortfolioQuotes,
  FundComposition,
  PortfolioHistory,
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
  InstrumentHit,
  Listing,
  SymbolSearchResult,
  WatchList,
  WatchlistView,
  VisitedSymbol,
} from '@/shared';

export const SESSION_LOST = 'watchlist:sin-sesion';
export const AUTH_CHANGED = 'watchlist.auth-changed';
/** Última primera pantalla recibida (ver `api/bootstrap.ts`); se borra al perder la sesión. */
export const LS_SNAPSHOT = 'watchlist.primeraPantalla';

export function reloadSession(to = '/') {
  localStorage.setItem(AUTH_CHANGED, crypto.randomUUID());
  window.location.replace(to);
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

/** En `/demo` la app funciona con datos ficticios en el navegador y no llama al servidor. */
export const DEMO = window.location.pathname.startsWith('/demo');

/**
 * Sesión: el access token (JWT de 15 min) vive solo en memoria; el refresh token, en una cookie HttpOnly que el
 * navegador manda únicamente a /api/auth/session. Al arrancar y ante un 401 se pide uno nuevo, de uno en uno.
 * La marca de localStorage solo indica que hay sesión, para no pedir un refresco que va a fallar.
 */
const SESSION_HINT = 'cartera.session';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
/** Usuario que llegó con el último token: así arrancar no espera a pedir `/api/users/me`. */
let tokenUser: SessionUser | null = null;

interface TokenResponse { accessToken: string; user?: SessionUser | null }

function setAccessToken(token: string | null, user: SessionUser | null = null) {
  accessToken = token;
  tokenUser = token ? user : null;
  if (token) localStorage.setItem(SESSION_HINT, '1');
  else {
    localStorage.removeItem(SESSION_HINT);
    localStorage.removeItem(LS_SNAPSHOT);
  }
}

/** Pide un access token con la cookie. Falso si no hay sesión; lanza si no hay conexión. */
function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/session/refresh', { method: 'POST', credentials: 'same-origin' });
      if (res.ok) {
        const t = (await res.json()) as TokenResponse;
        setAccessToken(t.accessToken, t.user);
        return true;
      }
      if (res.status === 401) { setAccessToken(null); return false; }
      throw new ApiError(res.status, `Error ${res.status}`);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const isAuthRoute = (url: string) => url.startsWith('/api/auth/');

async function send(method: string, url: string, body?: unknown, isForm = false): Promise<Response> {
  if (DEMO) return (await import('../demo/backend.ts')).demoFetch(method, url, body);
  const headers: Record<string, string> = {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (accessToken && !isAuthRoute(url)) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
}

/** Petición autenticada que devuelve la respuesta tal cual (para descargas). */
export async function authorizedFetch(method: string, url: string, body?: unknown): Promise<Response> {
  if (!DEMO && !accessToken && !isAuthRoute(url) && localStorage.getItem(SESSION_HINT)) await refreshAccessToken();
  let res = await send(method, url, body);
  if (!DEMO && res.status === 401 && !isAuthRoute(url) && await refreshAccessToken()) res = await send(method, url, body);
  // Sesión caducada o cerrada en otro sitio: la app vuelve a la pantalla de entrada.
  if (res.status === 401 && !isAuthRoute(url)) window.dispatchEvent(new Event(SESSION_LOST));
  return res;
}

/** Descarga un fichero de la API con la sesión; el nombre sale de Content-Disposition si lo hay. */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await authorizedFetch('GET', url);
  if (!res.ok) throw new ApiError(res.status, `Error ${res.status}`);
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await authorizedFetch(method, url, body);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Error ${res.status}`, data.issues);
  return data as T;
}

export interface AuthConfig { googleClientId: string | null; registrationEnabled: boolean }
export interface SessionUser { id: string; email: string; googleLinked: boolean }
export interface Session extends AuthConfig { authenticated: boolean; user: SessionUser | null }

export interface Bootstrap {
  settings: Settings;
  lists: WatchList[];
  visited: VisitedSymbol[];
  touchedOrders: TouchedOrder[];
  listId: number | null;
  watchlist: WatchlistView | null;
  portfolio: CarteraView;
}

async function loadSession(): Promise<Session> {
  // A la vez: la configuración no depende de la sesión.
  const [config, signedIn] = await Promise.all([
    request<AuthConfig>('GET', '/api/auth/config'),
    DEMO || !!accessToken || (!!localStorage.getItem(SESSION_HINT) && refreshAccessToken()),
  ]);
  // El del token solo vale una vez: después (p. ej. tras vincular Google) se pide de nuevo.
  const fromToken = tokenUser;
  tokenUser = null;
  const user = !signedIn ? null : fromToken ?? await request<SessionUser>('GET', '/api/users/me').catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  });
  return { ...config, authenticated: !!user, user };
}

async function startSession(url: string, body: unknown) {
  const t = await request<TokenResponse>('POST', url, body);
  setAccessToken(t.accessToken, t.user);
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>('GET', '/api/health'),
  /** La primera pantalla en una sola petición (ver `api/bootstrap.ts`). */
  bootstrap: (list: number | null, page: 'lista' | 'cartera') =>
    request<Bootstrap>('GET', `/api/bootstrap?page=${page}${list != null ? `&list=${list}` : ''}`),
  session: loadSession,
  login: (email: string, password: string) => startSession('/api/auth/password/login', { email, password }),
  register: (email: string, password: string) => startSession('/api/auth/password/register', { email, password }),
  loginWithGoogle: (credential: string) => startSession('/api/auth/google/login', { credential }),
  linkGoogle: (credential: string) => request<SessionUser>('POST', '/api/auth/google/link', { credential }),
  logout: async () => {
    try { await request<void>('POST', '/api/auth/session/logout'); } finally { setAccessToken(null); }
  },

  pushKey: () => request<{ publicKey: string | null; enabled: boolean }>('GET', '/api/push/key'),
  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string) =>
    request<{ ok: true }>('POST', '/api/push/subscribe', { subscription, label }),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/api/push/unsubscribe', { endpoint }),
  pushDevices: () => request<PushDevice[]>('GET', '/api/push/devices'),
  removeDevice: (id: number) => request<void>('DELETE', `/api/push/devices/${id}`),
  pushTest: () => request<{ sent: number; failed: number }>('POST', '/api/push/test', {}),
  checkAlerts: () => request<{ alerts: number }>('POST', '/api/alerts/check', {}),
  touchedOrders: () => request<TouchedOrder[]>('GET', '/api/orders/touched'),
  checkTouchedOrders: () => request<TouchedOrder[]>('POST', '/api/orders/touched/check', {}),
  dismissTouchedOrder: (itemId: number) => request<void>('DELETE', `/api/orders/touched/${itemId}`),

  snapshots: () => request<SnapshotInfo[]>('GET', '/api/snapshots'),
  restoreSnapshot: (id: number) =>
    request<{ lists: number; items: number; operations: number; savedTo: string | null }>('POST', `/api/snapshots/${id}/restore`, {}),

  settings: () => request<Settings>('GET', '/api/settings'),
  updateSettings: (patch: Partial<Settings>) => request<Settings>('PATCH', '/api/settings', patch),

  lists: () => request<WatchList[]>('GET', '/api/lists'),
  createList: (name: string) => request<WatchList>('POST', '/api/lists', { name }),
  renameList: (id: number, name: string) => request<WatchList>('PATCH', `/api/lists/${id}`, { name }),
  deleteList: (id: number) => request<void>('DELETE', `/api/lists/${id}`),
  /** `live`: precios casi en directo (caché de 1,5 s en el servidor) para la lista en pantalla. */
  watchlist: (id: number, force = false, live = false) =>
    request<WatchlistView>(
      'GET',
      `${id === VISITED_LIST_ID ? '/api/visited' : `/api/lists/${id}`}/watchlist${force ? '?force=1' : live ? '?live=1' : ''}`,
    ),
  /** «Visitados»: lo abierto desde el buscador de la cabecera. */
  visited: () => request<VisitedSymbol[]>('GET', '/api/visited'),
  visit: (r: SymbolSearchResult) => request<VisitedSymbol[]>('POST', '/api/visited', r),
  unvisit: (symbol: string) => request<VisitedSymbol[]>('DELETE', `/api/visited/${encodeURIComponent(symbol)}`),

  createItem: (data: ItemInput) => request<Item>('POST', '/api/items', data),
  updateItem: (id: number, patch: ItemPatch) => request<Item>('PATCH', `/api/items/${id}`, patch),
  deleteItem: (id: number) => request<void>('DELETE', `/api/items/${id}`),

  portfolio: (force = false, live = false) => request<CarteraView>('GET', `/api/portfolio${force ? '?force=1' : live ? '?live=1' : ''}`),
  portfolioQuotes: () => request<PortfolioQuotes>('GET', '/api/portfolio/quotes'),
  portfolioComposition: () => request<Record<string, FundComposition | null>>('GET', '/api/portfolio/composition'),
  portfolioHistory: (from: string, to: string) => request<PortfolioHistory>('GET', `/api/portfolio/history?${new URLSearchParams({ from, to })}`),
  createOperation: (operation: OperationInput, instrument?: Partial<InstrumentInput>) =>
    request<Operation>('POST', '/api/operations', { operation, instrument }),
  updateOperation: (id: number, operation: OperationInput, instrument?: Partial<InstrumentInput>) =>
    request<Operation>('PUT', `/api/operations/${id}`, { operation, instrument }),
  deleteOperation: (id: number) => request<void>('DELETE', `/api/operations/${id}`),
  setBroker: (ids: number[], broker: string | null, needsReview = false) =>
    request<{ updated: number }>('POST', '/api/operations/broker', { ids, broker, needsReview }),
  updateInstrument: (ticker: string, patch: InstrumentPatch) =>
    request<Instrument>('PUT', `/api/instruments/${encodeURIComponent(ticker)}`, patch),
  importCartera: (data: CarteraImport) =>
    request<{ imported: number; skipped: number; savedTo: number | null }>('POST', '/api/portfolio/import', data),

  search: (q: string) => request<SymbolSearchResult[]>('GET', `/api/market/search?q=${encodeURIComponent(q)}`),
  instruments: (q: string) => request<InstrumentHit[]>('GET', `/api/market/instruments?q=${encodeURIComponent(q)}`),
  listings: (isin: string) => request<Listing[]>('GET', `/api/market/listings?isin=${encodeURIComponent(isin)}`),
  fx: (currencies: string[], date?: string, base?: string) =>
    request<Record<string, number>>('GET', `/api/market/fx?currencies=${encodeURIComponent(currencies.join(','))}${date ? `&date=${date}` : ''}${base ? `&base=${base}` : ''}`),
  quotes: (symbols: string[]) => request<Quote[]>('GET', `/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  importRows: (listId: number, items: ImportRow[]) =>
    request<{ created: number; updated: number }>('POST', `/api/lists/${listId}/import`, { items }),
  quote: (symbol: string) => request<Quote>('GET', `/api/market/quote/${encodeURIComponent(symbol)}`),
  targets: (symbol: string) => request<{ targets: AnalystTargets | null }>('GET', `/api/market/targets/${encodeURIComponent(symbol)}`),
  /** Cotización casi en directo (caché de 1,5 s en el servidor) para el gráfico abierto. */
  live: (symbol: string) => request<Quote>('GET', `/api/market/live/${encodeURIComponent(symbol)}`),
  history: (symbol: string, range: HistoryRange) =>
    request<{ points: PricePoint[]; stale: boolean }>('GET', `/api/market/history/${encodeURIComponent(symbol)}?range=${range}`),
  candles: (symbol: string, interval: '1d' | IntradayInterval = '1d') =>
    request<{ candles: Candle[]; stale: boolean }>(
      'GET',
      `/api/market/candles/${encodeURIComponent(symbol)}${interval === '1d' ? '' : `?interval=${interval}`}`,
    ),
  /** Velas diarias de toda la historia del valor (se piden al alejar el gráfico). */
  allCandles: (symbol: string) =>
    request<{ candles: Candle[]; stale: boolean }>('GET', `/api/market/candles/${encodeURIComponent(symbol)}?range=max`),
  drawings: (symbol: string) => request<ChartDrawing[]>('GET', `/api/drawings/${encodeURIComponent(symbol)}`),
  saveDrawings: (symbol: string, drawings: ChartDrawing[]) =>
    request<ChartDrawing[]>('PUT', `/api/drawings/${encodeURIComponent(symbol)}`, drawings),
  sparklines: (symbols: string[], range: '3m' | '1y' = '3m') =>
    request<Record<string, number[]>>(
      'GET',
      `/api/market/sparklines?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`,
    ),

  alerts: () => request<AlertRecord[]>('GET', '/api/alerts'),
  importBackup: (data: Backup) =>
    request<{ lists: number; items: number; operations: number; savedTo: string | null }>('POST', '/api/backup', data),
};
