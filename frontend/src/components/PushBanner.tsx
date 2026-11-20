import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { currentSubscription, enablePush, needsHomeScreen, pushSupported } from '../lib/push.ts';

const DISMISS_KEY = 'watchlist.avisoNotificaciones';
const DISMISS_DAYS = 14;

type State = 'checking' | 'off' | 'blocked' | 'homeScreen' | 'hidden';

/**
 * Si este dispositivo no recibe los avisos, lo dice y ofrece activarlos con un toque.
 * «Ahora no» lo oculta dos semanas en este dispositivo.
 */
export function PushBanner() {
  const qc = useQueryClient();
  const key = useQuery({ queryKey: ['push-key'], queryFn: api.pushKey, staleTime: Infinity });
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key.data) return;
    const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (!key.data.enabled || Date.now() < dismissed) return setState('hidden');
    if (needsHomeScreen()) return setState('homeScreen');
    if (!pushSupported()) return setState('hidden');
    if (Notification.permission === 'denied') return setState('blocked');
    void currentSubscription().then((s) => setState(s ? 'hidden' : 'off'));
  }, [key.data]);

  if (state === 'checking' || state === 'hidden') return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
    setState('hidden');
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const err = await enablePush();
      if (err) {
        setError(err);
        if (Notification.permission === 'denied') setState('blocked');
      } else {
        setState('hidden');
        await qc.invalidateQueries({ queryKey: ['push-devices'] });
      }
    } catch {
      setError('No se pudieron activar. Vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="update-banner push-banner" role="status">
      <span>
        {state === 'off' && (
          <>
            <strong>Este dispositivo no recibe los avisos.</strong> Actívalos para enterarte cuando un valor llegue a tu
            precio, aunque no tengas la web abierta.
          </>
        )}
        {state === 'blocked' && (
          <>
            <strong>Las notificaciones están bloqueadas en este navegador.</strong> Pulsa el candado junto a la dirección →
            Notificaciones → Permitir, y recarga la página.
          </>
        )}
        {state === 'homeScreen' && (
          <>
            <strong>Para recibir avisos en el iPhone o iPad</strong>, añade la web a la pantalla de inicio (Compartir →
            Añadir a pantalla de inicio) y ábrela desde ese icono.
          </>
        )}
        {error && <span className="push-banner__error"> {error}</span>}
      </span>
      <span className="push-banner__actions">
        {state === 'off' && (
          <button type="button" className="btn btn--primary btn--small" onClick={enable} disabled={busy}>
            {busy ? 'Activando…' : 'Activar avisos'}
          </button>
        )}
        <button type="button" className="btn btn--small" onClick={dismiss}>
          Ahora no
        </button>
      </span>
    </div>
  );
}
