import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../../../web/public/sw.js', import.meta.url), 'utf8');

async function receive(session: object | Error, accountId = 'alice') {
  const listeners = new Map<string, (event: object) => void>();
  const showNotification = vi.fn();
  const fetch = vi.fn(async () => {
    if (session instanceof Error) throw session;
    return { ok: true, json: async () => session };
  });
  runInNewContext(source, {
    self: { addEventListener: (name: string, callback: (event: object) => void) => listeners.set(name, callback), registration: { showNotification } },
    fetch,
  });
  let pending: Promise<void> | undefined;
  listeners.get('push')!({
    data: { json: () => ({ title: 'Aviso privado', body: 'Compra de Alice', accountId }) },
    waitUntil: (work: Promise<void>) => { pending = work; },
  });
  await pending;
  return { showNotification, fetch };
}

describe('privacidad de las notificaciones en un navegador compartido', () => {
  it('muestra el aviso solo cuando corresponde a la sesión actual', async () => {
    const { showNotification, fetch } = await receive({ authRequired: true, authenticated: true, user: { id: 'alice' } });
    expect(showNotification).toHaveBeenCalledWith('Aviso privado', expect.objectContaining({ body: 'Compra de Alice' }));
    expect(fetch).toHaveBeenCalledWith('/api/session', { cache: 'no-store', credentials: 'same-origin' });
  });
  it.each([
    { authRequired: true, authenticated: true, user: { id: 'bob' } },
    { authRequired: true, authenticated: false, user: null },
    new Error('Sin conexión'),
  ])('oculta avisos tras cambiar de cuenta, cerrar sesión o perder conexión (%j)', async (session) => {
    expect((await receive(session)).showNotification).not.toHaveBeenCalled();
  });
  it('oculta los avisos antiguos que no identifican la cuenta', async () => {
    expect((await receive({ authRequired: true, authenticated: true, user: { id: 'alice' } }, '')).showNotification).not.toHaveBeenCalled();
  });
});
