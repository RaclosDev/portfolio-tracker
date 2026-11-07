import { useEffect, useState } from 'react';
import { desktop, type WhatsNew } from '../desktop.ts';
import { Dialog } from './Dialog.tsx';

/** Tras una actualización, enseña una vez qué ha cambiado (mensajes de los cambios publicados). */
export function WhatsNewDialog() {
  const [info, setInfo] = useState<WhatsNew | null>(null);

  useEffect(() => {
    if (!desktop) return;
    // Las novedades se preparan al arrancar; se pregunta un par de veces por si aún no han llegado.
    let tries = 0;
    const t = setInterval(() => {
      void desktop!.whatsNew().then((w) => {
        if (w) {
          setInfo(w);
          clearInterval(t);
        }
      });
      if (++tries >= 3) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, []);

  if (!info) return null;
  const close = () => {
    void desktop?.markWhatsNewSeen();
    setInfo(null);
  };
  return (
    <Dialog
      title="Novedades de Watchlist"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn--primary" onClick={close}>
            Entendido
          </button>
        </>
      }
    >
      <p className="muted small">Cambios desde la última vez que abriste la app en este PC:</p>
      <ul className="whatsnew">
        {info.items.map((it, i) => (
          <li key={i}>
            <strong>{it.title}</strong>
            {it.details.length > 0 && (
              <ul>
                {it.details.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
