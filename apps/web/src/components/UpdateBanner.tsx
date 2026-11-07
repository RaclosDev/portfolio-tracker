import { useEffect, useState } from 'react';
import { desktop, type UpdateInfo } from '../desktop.ts';

/** Aviso de versión nueva (solo app de escritorio). Si no se pulsa, se instala al cerrar la ventana. */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void desktop.updateStatus().then((i) => i && setInfo(i));
    return desktop.onUpdateAvailable(setInfo);
  }, []);

  if (!info) return null;
  return (
    <div className="update-banner" role="status">
      <span>
        <strong>Hay una versión nueva de Watchlist.</strong> Se instalará sola al cerrar la ventana, o ahora mismo (tarda
        unos segundos).
      </span>
      <button
        type="button"
        className="btn btn--primary btn--small"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void desktop!.applyUpdate();
        }}
      >
        {busy ? 'Actualizando…' : 'Actualizar ahora'}
      </button>
    </div>
  );
}
