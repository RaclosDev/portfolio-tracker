import type { ChartDrawing } from '@/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.ts';

/** Los dibujos de un valor en la caché de consultas. */
export const drawingsKey = (symbol: string) => ['drawings', symbol] as const;

export const drawingsQuery = (symbol: string) => ({
  queryKey: drawingsKey(symbol),
  queryFn: () => api.drawings(symbol),
  staleTime: Infinity,
});

/** El servidor sustituye TODOS los dibujos del valor en cada guardado. */
export const NOT_LOADED = 'Los dibujos de este valor aún no se han cargado: no se guarda nada para no borrar los anteriores.';

/**
 * Guardado de los dibujos de un valor. Solo se guarda si la lista ya se cargó bien: sobre una lista desconocida
 * (cargando o fallida), `[nuevo]` borraría en el servidor todos los dibujos anteriores. Los guardados del mismo
 * valor van de uno en uno porque cada uno necesita la versión que dejó el anterior (ver `api.saveDrawings`).
 */
export const drawingsSave = (qc: QueryClient, symbol: string) => ({
  scope: { id: `drawings:${symbol}` },
  mutationFn: (next: ChartDrawing[]) => api.saveDrawings(symbol, next),
  onMutate: (next: ChartDrawing[]) => {
    if (qc.getQueryState(drawingsKey(symbol))?.status !== 'success') throw new Error(NOT_LOADED);
    qc.setQueryData(drawingsKey(symbol), next);
  },
  // Si falla (también por un 409 de otro dispositivo), se vuelve a leer la lista del servidor.
  onError: () => qc.invalidateQueries({ queryKey: drawingsKey(symbol) }),
});
