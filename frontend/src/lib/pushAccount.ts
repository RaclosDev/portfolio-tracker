/**
 * Cuenta con la sesión abierta en ESTE navegador, guardada en IndexedDB para el service worker.
 * El service worker no tiene el JWT (vive solo en memoria de la página) ni puede llamar a la API: al llegar un
 * aviso compara este id con el `accountId` que viaja en el push y solo lo enseña si coinciden.
 * Base, almacén y clave tienen que coincidir con los de `public/sw.js`.
 */
const DB_NAME = 'cartera-push';
const STORE = 'account';
const KEY = 'accountId';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(id: string | null): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (id === null) tx.objectStore(STORE).delete(KEY);
      else tx.objectStore(STORE).put(id, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Anota la cuenta de la sesión abierta (al iniciar sesión y al arrancar con sesión). No lanza. */
export const rememberPushAccount = (id: string) => write(id).catch(() => {});

/** Borra la cuenta (al cerrar o perder la sesión): sin ella, el service worker descarta los avisos. No lanza. */
export const forgetPushAccount = () => write(null).catch(() => {});
