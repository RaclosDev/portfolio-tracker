/**
 * Acceso con contraseña (una sola cuenta, la de la familia).
 * La sesión es una cookie firmada (HMAC) que dura 180 días: no hace falta guardarla en la base de
 * datos. Al cambiar APP_PASSWORD en Render se cierran todas las sesiones, porque la contraseña
 * forma parte de la clave de firma.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export const SESSION_COOKIE = 'wl_sesion';
const SESSION_DAYS = 180;
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60_000;

export interface AuthOptions {
  password: string | null;
  secret: string | null;
  /** Cookie solo por HTTPS (producción). */
  secure: boolean;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Rutas que no necesitan sesión. */
const PUBLIC_API = new Set(['/api/health', '/api/session', '/api/login', '/api/logout', '/api/push/key']);

export function registerAuth(app: FastifyInstance, opts: AuthOptions) {
  const enabled = !!opts.password;
  const key = enabled ? crypto.createHmac('sha256', opts.secret ?? 'sin-secreto').update(sha256(opts.password!)).digest() : null;

  const sign = (payload: string) => crypto.createHmac('sha256', key!).update(payload).digest('base64url');
  const issue = () => {
    const payload = `${Date.now() + SESSION_DAYS * 86_400_000}.${crypto.randomBytes(9).toString('base64url')}`;
    return `${payload}.${sign(payload)}`;
  };
  const valid = (token: string | undefined) => {
    if (!enabled) return true;
    if (!token) return false;
    const i = token.lastIndexOf('.');
    if (i < 0) return false;
    const payload = token.slice(0, i);
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(token.slice(i + 1));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    return Number(payload.split('.')[0]) > Date.now();
  };
  const cookie = (value: string, maxAgeSec: number) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${opts.secure ? '; Secure' : ''}`;

  const isLogged = (req: FastifyRequest) => valid(parseCookies(req.headers.cookie)[SESSION_COOKIE]);

  // Intentos fallidos por IP: tras 5, se bloquea 15 minutos.
  const fails = new Map<string, { n: number; until: number }>();

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    // Peticiones que cambian datos: solo desde la propia web (además de la cookie SameSite).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) {
        return reply.code(403).send({ error: 'Origen no permitido' });
      }
    }
    if (PUBLIC_API.has(url) || isLogged(req)) return;
    return reply.code(401).send({ error: 'Tienes que entrar con la contraseña' });
  });

  app.get('/api/session', async (req) => ({ authRequired: enabled, authenticated: isLogged(req) }));

  app.post('/api/login', async (req, reply) => {
    if (!enabled) return { ok: true };
    const ip = req.ip;
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      return reply.code(429).send({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });
    }
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    if (!crypto.timingSafeEqual(sha256(password), sha256(opts.password!))) {
      const n = (f?.n ?? 0) + 1;
      fails.set(ip, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + BLOCK_MS : 0 });
      return reply.code(401).send({ error: 'Contraseña incorrecta' });
    }
    fails.delete(ip);
    reply.header('Set-Cookie', cookie(issue(), SESSION_DAYS * 86_400));
    return { ok: true };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.header('Set-Cookie', cookie('', 0));
    return { ok: true };
  });
}
