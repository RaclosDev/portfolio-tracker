// Service worker: recibe los avisos de precio (Web Push) aunque la web esté cerrada y, al pulsar
// una notificación, abre la app (o la trae al frente si ya está abierta). No guarda nada en caché:
// los precios tienen que ser siempre los del servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Watchlist';
  event.waitUntil(
    (async () => {
      // Una suscripción puede sobrevivir a un cambio de cuenta en el mismo navegador.
      const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const session = await response.json();
      if (session.authRequired && (!session.authenticated || !data.accountId || session.user?.id !== data.accountId)) return;
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag,
        renotify: !!data.tag,
        data: { url: data.url || '/' },
      });
    })().catch(() => {}),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
