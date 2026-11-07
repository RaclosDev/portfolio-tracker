import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from '../api/client.ts';

/**
 * Aviso de versión nueva: cada vez que se publica, el servidor cambia de versión. Si esta pestaña
 * se abrió con una anterior, se ofrece recargar (los datos están en el servidor, no se pierde nada).
 */
export function UpdateBanner() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 5 * 60_000, staleTime: 60_000 });
  const first = useRef<string | null>(null);
  if (health.data && first.current == null) first.current = health.data.version;
  const changed = !!health.data && first.current != null && health.data.version !== first.current;
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
