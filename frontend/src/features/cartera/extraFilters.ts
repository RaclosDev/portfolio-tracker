import { useEffect } from 'react';

/** Filtros propios de una pestaña de Cartera, vistos desde fuera: cuántos hay puestos y cómo quitarlos todos. */
export interface ExtraFilters {
  count: number;
  clear: () => void;
}

/** Avisa a la página de los filtros puestos en la pestaña, y de que ya no hay ninguno al salir de ella. */
export function useReportFilters(report: ((f: ExtraFilters | null) => void) | undefined, count: number, clear: () => void) {
  useEffect(() => {
    report?.({ count, clear });
    return () => report?.(null);
    // «clear» solo llama a los «set» del estado: no cambia entre pintados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, count]);
}
