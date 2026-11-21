import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext.ts';

const ORIGIN = 'https://cartera.raclos.es';
const next = (raw: string | null) => safeNext(raw, ORIGIN);

describe('safeNext', () => {
  it('sin destino va a la portada de la app', () => {
    expect(next(null)).toBe('/');
    expect(next('')).toBe('/');
  });

  it('acepta rutas de la propia web', () => {
    expect(next('/demo')).toBe('/demo');
    expect(next('/cartera/SAN.MC?x=1#a')).toBe('/cartera/SAN.MC?x=1#a');
  });

  it('descarta destinos externos o raros', () => {
    for (const raw of ['https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', 'javascript:alert(1)', 'evil.com']) {
      expect(new URL(next(raw), ORIGIN).origin).toBe(ORIGIN);
    }
    expect(next('https://evil.com')).toBe('/');
    expect(next('//evil.com')).toBe('/');
    expect(next('/\\evil.com')).toBe('/');
  });

  it('no vuelve a las páginas de acceso', () => {
    expect(next('/login')).toBe('/');
    expect(next('/registro?next=/demo')).toBe('/');
  });
});
