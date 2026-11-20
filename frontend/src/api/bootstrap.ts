import type { QueryClient } from '@tanstack/react-query';
import { touchedKey } from '../components/TouchedOrders.tsx';
import { api } from './client.ts';
import { keys } from './hooks.ts';

/** Lista abierta y pantalla visible que recuerda el navegador. */
export const LS_LIST = 'watchlist.listId';
export const LS_PAGE = 'watchlist.pagina';

/**
 * Pide la primera pantalla de una vez y la deja en la caché, para que la lista y la cartera aparezcan juntas
 * (antes eran nueve peticiones que el servidor atendía en fila y la tabla se movía al llegar la cartera).
 * Si falla, la app arranca igual y cada parte se pide por su cuenta.
 */
export async function seedFirstScreen(qc: QueryClient): Promise<true> {
  const page = localStorage.getItem(LS_PAGE) === 'cartera' ? 'cartera' : 'lista';
  const saved = Number(localStorage.getItem(LS_LIST)) || null;
  try {
    const b = await api.bootstrap(saved, page);
    qc.setQueryData(keys.settings, b.settings);
    qc.setQueryData(keys.lists, b.lists);
    qc.setQueryData(keys.visited, b.visited);
    qc.setQueryData(touchedKey, b.touchedOrders);
    qc.setQueryData(keys.portfolio, b.portfolio);
    if (b.listId != null) {
      localStorage.setItem(LS_LIST, String(b.listId));
      if (b.watchlist) qc.setQueryData(keys.watchlist(b.listId), b.watchlist);
    }
  } catch {
    // Sin arranque conjunto: cada consulta se pedirá al montar.
  }
  return true;
}
