import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Services } from '../../services.ts';
import { Accounts, hashPassword, verifyPassword, type Account } from './accounts.ts';
import { registerGoogleAuth, type GoogleOptions } from './google.ts';
import type { UserServices } from './user-services.ts';

export const SESSION_COOKIE = 'wl_sesion';
const SESSION_SECONDS = 180 * 86_400;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const credentialsSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
const registrationSchema = credentialsSchema.extend({ password: z.string().min(12).max(200) });
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export interface AuthOptions {
  password: string | null;
  ownerEmail: string | null;
  secret: string | null;
  google?: GoogleOptions;
  secure: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    account: Account | null;
    services: Services;
  }
}

function readCookie(req: FastifyRequest, name: string) {
  const prefix = `${name}=`;
  return req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

export async function registerAuth(app: FastifyInstance, opts: AuthOptions, services: Services, users: UserServices) {
  const enabled = !!opts.password;
  const ownerEmail = opts.ownerEmail?.trim().toLowerCase();
  if (enabled && (!emailSchema.safeParse(ownerEmail).success || !opts.secret)) {
    throw new Error('Configura APP_OWNER_EMAIL y SESSION_SECRET para habilitar las cuentas.');
  }
  const accounts = enabled ? new Accounts(services.db) : null;
  if (accounts) await accounts.initialize(ownerEmail!, opts.password!);
  const google = enabled ? opts.google : undefined;
  const publicApi = new Set(['/api/health', '/api/session', '/api/login', '/api/register', '/api/logout', '/api/push/key']);
  if (google) {
    publicApi.add('/api/auth/google');
    publicApi.add('/api/auth/google/callback');
  }
  const cookie = (name: string, value: string, maxAge: number, path = '/') =>
    `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${opts.secure ? '; Secure' : ''}`;
  const tokenHash = (req: FastifyRequest) => {
    const token = readCookie(req, SESSION_COOKIE);
    return token && /^[\w-]{43}$/.test(token) ? digest(token) : null;
  };
  const setSession = async (reply: FastifyReply, account: Account) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await services.db.query(`INSERT INTO watchlist_auth.sessions (token_hash, account_id, expires_at)
      VALUES ($1, $2, $3)`, [digest(token), account.id, new Date(Date.now() + SESSION_SECONDS * 1000)]);
    reply.header('Set-Cookie', cookie(SESSION_COOKIE, token, SESSION_SECONDS));
  };

  const limits = new Map<string, { n: number; until: number }>();
  const take = (key: string, max: number, windowMs: number) => {
    const now = Date.now();
    if (limits.size >= 10_000) for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
    const current = limits.get(key);
    if (!current || current.until <= now) {
      if (limits.size >= 10_000) return false;
      limits.set(key, { n: 1, until: now + windowMs });
      return true;
    }
    return ++current.n <= max;
  };
  let passwordWork = 0;
  const busy = (reply: FastifyReply) => reply.header('Retry-After', '60').code(429)
    .send({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' });

  app.decorateRequest('account', null);
  app.decorateRequest('services');
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let host: string;
      try { host = new URL(req.headers.origin).host; } catch { return reply.code(403).send({ error: 'Origen no permitido' }); }
      if (host !== req.headers.host) return reply.code(403).send({ error: 'Origen no permitido' });
    }
    req.services = services;
    if (enabled) {
      const hash = tokenHash(req);
      if (hash) req.account = await services.db.one<Account>(`SELECT a.* FROM watchlist_auth.accounts a
        JOIN watchlist_auth.sessions s ON s.account_id = a.id WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash]) ?? null;
      if (req.account) req.services = users.forSchema(req.account.db_schema, req.account.id);
      if (!publicApi.has(url) && !req.account) return reply.code(401).send({ error: 'Tienes que iniciar sesión' });
    }
    if (['/api/login', '/api/register', '/api/auth/google', '/api/auth/google/callback'].includes(url)) {
      if (!take('auth-global', 120, 60_000) || !take(`auth:${req.ip}`, 30, 60_000)) return busy(reply);
    }
  });

  app.get('/api/session', async (req) => ({
    authRequired: enabled, authenticated: !enabled || !!req.account, googleEnabled: !!google,
    registrationEnabled: enabled,
    user: req.account ? { id: req.account.id, email: req.account.email, googleLinked: !!req.account.google_subject } : null,
  }));

  if (google && accounts) registerGoogleAuth(app, google, {
    readCookie, cookie,
    sign: (payload) => crypto.createHmac('sha256', opts.secret!).update(`google:${payload}`).digest('base64url'),
    setSession,
    resolveIdentity: async (identity, linkingId) => {
      const existingSubject = await accounts.byGoogle(identity.sub);
      if (existingSubject) return !linkingId || linkingId === existingSubject.id ? existingSubject : null;
      const email = emailSchema.safeParse(identity.email);
      if (!email.success) return null;
      const existingEmail = await accounts.byEmail(email.data);
      if (existingEmail) {
        // La cuenta heredada ya tenía Google habilitado. Las demás se vinculan desde una sesión propia.
        const trustedOwner = existingEmail.db_schema === 'public' && (email.data.endsWith('@gmail.com') || !!identity.hd);
        if (linkingId === existingEmail.id || (!linkingId && trustedOwner)) return accounts.linkGoogle(existingEmail.id, identity.sub);
        return 'account-exists';
      }
      if (linkingId) return null;
      if (!take('registration-global', 30, 3_600_000)) return null;
      return accounts.create(email.data, null, identity.sub);
    },
  });

  app.post('/api/register', async (req, reply) => {
    if (!accounts) return reply.code(403).send({ error: 'El registro no está habilitado en este entorno.' });
    if (!take(`register:${req.ip}`, 5, 3_600_000) || !take('registration-global', 30, 3_600_000) || passwordWork >= 2) return busy(reply);
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Escribe un correo válido y una contraseña de entre 12 y 200 caracteres.' });
    passwordWork++;
    try {
      const hash = await hashPassword(parsed.data.password);
      const account = await accounts.create(parsed.data.email, hash);
      await setSession(reply, account);
      return reply.code(201).send({ ok: true });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
      throw error;
    } finally { passwordWork--; }
  });

  // Un hash de coste idéntico evita resolver más rápido los correos que no existen.
  const dummyHash = accounts ? await hashPassword(crypto.randomBytes(32).toString('hex')) : '';
  app.post('/api/login', async (req, reply) => {
    if (!accounts) return { ok: true };
    if (!take(`login:${req.ip}`, 5, 15 * 60_000) || passwordWork >= 2) return busy(reply);
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
    passwordWork++;
    try {
      const account = await accounts.byEmail(parsed.data.email);
      const correct = await verifyPassword(parsed.data.password, account?.password_hash ?? dummyHash);
      if (!account?.password_hash || !correct) return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
      limits.delete(`login:${req.ip}`);
      await setSession(reply, account);
      return { ok: true };
    } finally { passwordWork--; }
  });

  app.post('/api/logout', async (req, reply) => {
    const hash = tokenHash(req);
    if (accounts && hash) await services.db.query('DELETE FROM watchlist_auth.sessions WHERE token_hash = $1', [hash]);
    reply.header('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
    return { ok: true };
  });
  return accounts;
}
