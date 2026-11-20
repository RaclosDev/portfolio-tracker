import { VISITED_LIST_ID, type SymbolSearchResult, type VisitedSymbol } from '@/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { keys } from '../api/hooks.ts';

/**
 * Valores abiertos desde el buscador de la cabecera, el último primero. Se guardan en el servidor
 * (lista «Visitados»), así se ven igual en el móvil y en el ordenador.
 */
const EMPTY: VisitedSymbol[] = [];
// Antes se guardaban solo en este navegador.
localStorage.removeItem('watchlist.buscador.recientes');

export function useRecentSymbols() {
  return useQuery({ queryKey: keys.visited, queryFn: api.visited, staleTime: 60_000 }).data ?? EMPTY;
}

export function useRememberSymbol() {
  const qc = useQueryClient();
  return (r: SymbolSearchResult) => {
    const sym = r.symbol.toUpperCase();
    // Al momento en el desplegable y el carril; el servidor confirma después.
    qc.setQueryData<VisitedSymbol[]>(keys.visited, (prev = []) => {
      const old = prev.find((x) => x.symbol === sym);
      return [
        { ...old, ...r, symbol: sym, isin: r.isin ?? old?.isin ?? null, visitedAt: new Date().toISOString() },
        ...prev.filter((x) => x.symbol !== sym),
      ];
    });
    void api
      .visit(r)
      .then((list) => {
        qc.setQueryData(keys.visited, list);
        void qc.invalidateQueries({ queryKey: keys.watchlist(VISITED_LIST_ID) });
      })
      .catch(() => void qc.invalidateQueries({ queryKey: keys.visited }));
  };
}
