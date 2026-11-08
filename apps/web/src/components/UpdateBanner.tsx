import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../api/client.ts';

/** Hay algo a medio hacer (un diálogo abierto o un campo con el cursor dentro): no se recarga sola. */
function busy() {
  const el = document.activeElement;
  return (
    !!document.querySelector('dialog[open], [role="dialog"]') ||
    (el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
  );
}

/**
 * Versión nueva: cada publicación cambia la versión del servidor. Instalada como app (PWA, en el
 * móvil o en Windows) la ventana puede pasar días abierta, así que se comprueba cada 5 minutos y al
 * volver a ella. Si no estás usándola (ventana en segundo plano, sin nada a medio hacer) se
 * actualiza sola; si estás delante, se ofrece recargar. Los datos están en el servidor: no se pierde nada.
 */
export function UpdateBanner() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always',
    staleTime: 60_000,
  });
  const first = useRef<string | null>(null);
  if (health.data && first.current == null) first.current = health.data.version;
  const changed = !!health.data && first.current != null && health.data.version !== first.current;

  useEffect(() => {
    if (!changed) return;
    const reloadIfAway = () => {
      if (document.visibilityState === 'hidden' && !busy()) location.reload();
    };
    reloadIfAway();
    document.addEventListener('visibilitychange', reloadIfAway);
    return () => document.removeEventListener('visibilitychange', reloadIfAway);
  }, [changed]);

  if (!changed) return null;
  return (
    <div className="update-banner" role="status">
      <span>
        <strong>Hay una versión nueva de Watchlist.</strong> Recarga para usarla.
      </span>
      <button type="button" className="btn btn--primary btn--small" onClick={() => location.reload()}>
        Recargar
      </button>
    </div>
  );
}
