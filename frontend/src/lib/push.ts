/** Notificaciones del navegador (Web Push): activar o desactivar en ESTE dispositivo. */
import { api } from '../api/client.ts';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** En iPhone/iPad solo funcionan con la web añadida a la pantalla de inicio. */
export const needsHomeScreen = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function keyToBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Nombre del dispositivo para la lista de Ajustes («Android · Chrome»). */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iPhone/iPad' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : 'Otro';
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Navegador';
  return `${os} · ${browser}`;
}

/** Pide permiso, se suscribe y lo registra en el servidor. Devuelve un texto de error o null. */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return 'Este navegador no admite notificaciones.';
  if (needsHomeScreen()) return 'En iPhone o iPad, primero añade la web a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.';
  const { publicKey, enabled } = await api.pushKey();
  if (!enabled || !publicKey) return 'El servidor aún no tiene configuradas las notificaciones.';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Has bloqueado las notificaciones. Actívalas en los permisos del navegador para esta web.';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub: PushSubscription;
  try {
    sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  } catch {
    // Brave trae el servicio de notificaciones desactivado de serie.
    const isBrave = !!(navigator as Navigator & { brave?: unknown }).brave;
    return isBrave
      ? 'Brave tiene desactivadas las notificaciones push. Ve a brave://settings/privacy, activa «Usar los servicios de Google para la mensajería push», reinicia Brave y vuelve a pulsar.'
      : 'El navegador no ha podido registrar las notificaciones. Inténtalo de nuevo o prueba con Chrome.';
  }
  await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, deviceLabel());
  return null;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
