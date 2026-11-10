import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');

const num = (v: string | undefined, fallback: number) => (v && !Number.isNaN(+v) ? +v : fallback);
const env = (k: string) => process.env[k]?.trim() || null;

const production = process.env.NODE_ENV === 'production';

export const config = {
  production,
  /** En Render hay que escuchar en todas las interfaces; en local, solo en este PC. */
  host: process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1'),
  port: num(process.env.PORT, 5174),
  /** Postgres (Neon). Sin ella se usa PGlite en DATA_DIR (desarrollo). */
  databaseUrl: env('DATABASE_URL'),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(serverRoot, 'data', 'pg')),
  webDist: path.resolve(serverRoot, '../web/dist'),
  seedFile: path.join(serverRoot, 'seed', 'watchlist.seed.json'),
  quoteTtlMs: num(process.env.QUOTE_TTL_SECONDS, 45) * 1000,
  targetsTtlMs: num(process.env.TARGETS_TTL_HOURS, 12) * 3_600_000,
  /** Contraseña de acceso. Sin ella (solo en desarrollo) la app no pide entrar. */
  appPassword: env('APP_PASSWORD'),
  ownerEmail: env('APP_OWNER_EMAIL'),
  googleClientId: env('GOOGLE_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  /** Clave para firmar la sesión. Render la genera sola (render.yaml). */
  sessionSecret: env('SESSION_SECRET'),
  /** Claves VAPID para las notificaciones (npm run claves-push). */
  vapid: {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT') ?? 'mailto:avisos@raclos.es',
  },
  /** Dirección pública (para abrir la app al pulsar una notificación). */
  publicUrl: env('PUBLIC_URL'),
  /** Versión desplegada (Render pone el commit). */
  version: (env('RENDER_GIT_COMMIT') ?? env('WATCHLIST_VERSION') ?? 'desarrollo').slice(0, 7),
};
