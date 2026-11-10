/**
 * La cuenta propietaria accede a los datos existentes con contraseña o con Google.
 * La cookie de sesión está firmada y caduca a los 180 días.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { registerGoogleAuth, type GoogleOptions } from './google.ts';

export const SESSION_COOKIE = 'wl_sesion';
const SESSION_DAYS = 180;
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60_000;

export interface AuthOptions {
  password: string | null;
  ownerEmail: string | null;
  secret: string | null;
  google?: GoogleOptions;
  /** Cookie solo por HTTPS (producción). */
  secure: boolean;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

function readCookie(req: FastifyRequest, name: string) {
  const prefix = `${name}=`;
  return req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

/** Rutas que no necesitan sesión. */
const PUBLIC_API = new Set(['/api/health', '/api/session', '/api/login', '/api/logout', '/api/push/key']);

export function registerAuth(app: FastifyInstance, opts: AuthOptions) {
  const { password } = opts;
  const ownerEmail = opts.ownerEmail?.trim().toLowerCase();
  if (password && !z.email().safeParse(ownerEmail).success) {
    throw new Error('APP_OWNER_EMAIL debe contener el correo de la cuenta propietaria.');
  }
  const enabled = !!password;
  const key = password ? crypto.createHmac('sha256', opts.secret ?? 'sin-secreto')
    .update(sha256(password)).update(sha256(ownerEmail!)).digest() : null;
  const google = enabled && ownerEmail?.endsWith('@gmail.com') && opts.secret ? opts.google : undefined;
  const publicApi = new Set(PUBLIC_API);
  if (google) {
    publicApi.add('/api/auth/google');
    publicApi.add('/api/auth/google/callback');
  }

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
  const cookie = (name: string, value: string, maxAgeSec: number, path = '/') =>
    `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${opts.secure ? '; Secure' : ''}`;

  const isLogged = (req: FastifyRequest) => valid(readCookie(req, SESSION_COOKIE));
  const setSession = (reply: FastifyReply) => reply.header('Set-Cookie', cookie(SESSION_COOKIE, issue(), SESSION_DAYS * 86_400));

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
    if (publicApi.has(url) || isLogged(req)) return;
    return reply.code(401).send({ error: 'Tienes que iniciar sesión' });
  });

  app.get('/api/session', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { authRequired: enabled, authenticated: isLogged(req), googleEnabled: !!google };
  });

  if (google && ownerEmail) registerGoogleAuth(app, google, {
    ownerEmail, readCookie, cookie, sign: (payload) => sign(`google:${payload}`), setSession,
  });

  app.post('/api/login', async (req, reply) => {
    if (!password) return { ok: true };
    const ip = req.ip;
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      return reply.code(429).send({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });
    }
    const credentials = z.object({ email: z.string().max(254), password: z.string().max(200) }).safeParse(req.body);
    const correctPassword = crypto.timingSafeEqual(sha256(credentials.data?.password ?? ''), sha256(password));
    if (!credentials.success || credentials.data.email.trim().toLowerCase() !== ownerEmail || !correctPassword) {
      const n = (f?.n ?? 0) + 1;
      fails.set(ip, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + BLOCK_MS : 0 });
      return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
    }
    fails.delete(ip);
    setSession(reply);
    return { ok: true };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.header('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
    return { ok: true };
  });
}
