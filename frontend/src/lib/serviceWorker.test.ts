import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import swSource from '../../public/sw.js?raw';
import { forgetPushAccount, rememberPushAccount } from './pushAccount.ts';

/** Carga `public/sw.js` con un `self` simulado y devuelve lo necesario para lanzarle pushes. */
function loadServiceWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => {});
  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => { handlers[type] = handler; },
    registration: { showNotification },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    location: { origin: 'https://cartera.test' },
  };
  new Function('self', 'indexedDB', 'URL', swSource)(self, indexedDB, URL);
  async function push(payload: object | string) {
    const waiting: Promise<unknown>[] = [];
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    handlers.push!({
      data: { json: () => JSON.parse(data), text: () => data },
      waitUntil: (promise: Promise<unknown>) => { waiting.push(promise); },
    });
    await Promise.all(waiting);
  }
  return { push, showNotification };
}

const aviso = { title: 'ACME', body: 'Ha tocado tu nivel', tag: 'a1', url: '/lista', accountId: 'cuenta-1' };

describe('service worker: avisos push', () => {
  beforeEach(async () => { await forgetPushAccount(); });

  it('enseña el aviso si la sesión abierta es la de la cuenta del aviso', async () => {
    await rememberPushAccount('cuenta-1');
    const sw = loadServiceWorker();
    await sw.push(aviso);
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
    expect(sw.showNotification).toHaveBeenCalledWith('ACME', expect.objectContaining({
      body: 'Ha tocado tu nivel', tag: 'a1', data: { url: '/lista' },
    }));
  });

  it('no lo enseña si la sesión abierta es de otra cuenta', async () => {
    await rememberPushAccount('cuenta-2');
    const sw = loadServiceWorker();
    await sw.push(aviso);
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it('no lo enseña sin sesión (no hay cuenta anotada o se ha cerrado)', async () => {
    const sw = loadServiceWorker();
    await sw.push(aviso);
    expect(sw.showNotification).not.toHaveBeenCalled();

    await rememberPushAccount('cuenta-1');
    await forgetPushAccount();
    await sw.push(aviso);
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it('no lo enseña si el aviso no trae cuenta', async () => {
    await rememberPushAccount('cuenta-1');
    const sw = loadServiceWorker();
    await sw.push({ title: 'ACME', body: 'x' });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });
});
