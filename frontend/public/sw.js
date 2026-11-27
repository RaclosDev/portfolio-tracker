// Service worker: recibe los avisos de precio (Web Push) aunque la web esté cerrada y, al pulsar
// una notificación, abre la app (o la trae al frente si ya está abierta). No guarda nada en caché:
// los precios tienen que ser siempre los del servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// La página anota en IndexedDB la cuenta con sesión (src/lib/pushAccount.ts); aquí no hay JWT ni cookie
// con la que preguntar a la API. Sin cuenta anotada (sesión cerrada) no se enseña nada.
function readAccount() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('cartera-push', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('account');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction('account', 'readonly').objectStore('account').get('accountId');
      get.onsuccess = () => {
        db.close();
        resolve(get.result ?? null);
      };
      get.onerror = () => {
        db.close();
        reject(get.error);
      };
    };
  });
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Portfolio Tracker';
  event.waitUntil(
    (async () => {
      // Una suscripción puede sobrevivir a un cambio de cuenta en el mismo navegador: solo se enseña si la
      // cuenta con la sesión abierta aquí (la que anotó la página en IndexedDB) es la del aviso.
      const account = await readAccount();
      if (!account || !data.accountId || account !== data.accountId) return;
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
