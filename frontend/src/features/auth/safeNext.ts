/** Rutas de acceso: tras entrar no tiene sentido volver a ellas. */
export const AUTH_PATHS = ['/login', '/registro'];

/**
 * Destino tras entrar a partir de `?next=`. Solo vale una ruta de esta misma web («/algo»); cualquier otra cosa
 * (otra web, «//evil.com», «/\evil.com», «javascript:») se descarta y se va a la portada de la app, para que el
 * enlace de acceso no sirva de redirección abierta.
 */
export function safeNext(raw: string | null | undefined, origin = window.location.origin): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || AUTH_PATHS.includes(url.pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
