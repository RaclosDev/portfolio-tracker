import type { QueryClient } from '@tanstack/react-query';
import { touchedKey } from '../components/TouchedOrders.tsx';
import { api, LS_SNAPSHOT, type Bootstrap } from './client.ts';
import { keys } from './hooks.ts';

/** Lista abierta y pantalla visible que recuerda el navegador. */
export const LS_LIST = 'watchlist.listId';
export const LS_PAGE = 'watchlist.pagina';

/** Pasado este tiempo la copia guardada se descarta: mejor esqueletos que datos de hace días. */
const SNAPSHOT_MAX_AGE_MS = 3 * 24 * 3600_000;

interface Snapshot { account: string; savedAt: number; data: Bootstrap }

function apply(qc: QueryClient, b: Bootstrap) {
  qc.setQueryData(keys.settings, b.settings);
  qc.setQueryData(keys.lists, b.lists);
  qc.setQueryData(keys.visited, b.visited);
  qc.setQueryData(touchedKey, b.touchedOrders);
  qc.setQueryData(keys.portfolio, b.portfolio);
  if (b.listId != null && b.watchlist) qc.setQueryData(keys.watchlist(b.listId), b.watchlist);
}

/**
 * Pinta al instante la última primera pantalla que vio esta cuenta en este navegador; la petición de
 * `seedFirstScreen` la sustituye en cuanto llega. Devuelve si había copia válida.
 */
export function seedFromSnapshot(qc: QueryClient, account: string | null): boolean {
  if (!account || account === 'anonymous') return false;
  try {
    const raw = localStorage.getItem(LS_SNAPSHOT);
    if (!raw) return false;
    const snap = JSON.parse(raw) as Snapshot;
    const saved = Number(localStorage.getItem(LS_LIST)) || null;
    if (snap.account !== account || Date.now() - snap.savedAt > SNAPSHOT_MAX_AGE_MS) return false;
    if (saved != null && snap.data.listId !== saved) return false;
    apply(qc, snap.data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pide la primera pantalla de una vez y la deja en la caché, para que la lista y la cartera aparezcan juntas
 * (antes eran nueve peticiones que el servidor atendía en fila y la tabla se movía al llegar la cartera).
 * Si falla, la app arranca igual y cada parte se pide por su cuenta.
 */
export async function seedFirstScreen(qc: QueryClient, account?: string): Promise<true> {
  const page = localStorage.getItem(LS_PAGE) === 'cartera' ? 'cartera' : 'lista';
  const saved = Number(localStorage.getItem(LS_LIST)) || null;
  try {
    const b = await api.bootstrap(saved, page);
    apply(qc, b);
    if (b.listId != null) localStorage.setItem(LS_LIST, String(b.listId));
    if (account && account !== 'anonymous') {
      try {
        localStorage.setItem(LS_SNAPSHOT, JSON.stringify({ account, savedAt: Date.now(), data: b } satisfies Snapshot));
      } catch {
        localStorage.removeItem(LS_SNAPSHOT); // sin hueco: se prescinde de la copia
      }
    }
  } catch {
    // Sin arranque conjunto: cada consulta se pedirá al montar.
  }
  return true;
}
