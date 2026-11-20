import { useCallback, useSyncExternalStore } from 'react';

/** Si la pantalla cumple la media query, al día cuando cambia (girar el móvil, estrechar la ventana). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** El mismo corte que usa la hoja de estilos para el móvil. */
export const MOBILE = '(max-width: 700px)';
