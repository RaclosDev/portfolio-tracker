import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Ancho y alto reales (px) de un elemento, actualizados al cambiar de tamaño.
 * Devuelve un ref de función: mide también si el elemento aparece más tarde.
 */
export function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useCallback((node: T | null) => setEl(node), []);
  useLayoutEffect(() => {
    if (!el) return;
    const set = (w: number, h: number) =>
      setSize((s) => (s.w === Math.round(w) && s.h === Math.round(h) ? s : { w: Math.round(w), h: Math.round(h) }));
    const ro = new ResizeObserver(([e]) => set(e!.contentRect.width, e!.contentRect.height));
    ro.observe(el);
    const r = el.getBoundingClientRect();
    set(r.width, r.height);
    return () => ro.disconnect();
  }, [el]);
  return [ref, size] as const;
}
