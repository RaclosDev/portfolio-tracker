import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler, registerRoutes } from './routes.ts';
import type { Services } from './services.ts';

/** Carpeta con el frontend compilado (apps/web/dist). */
export type WebSource = { kind: 'dir'; root: string };

/**
 * Nombres con los que se puede llegar a la API. Cualquier otro se rechaza: así una web externa no
 * puede usar un ataque de "DNS rebinding" para leer o cambiar los datos aunque la app esté abierta.
 * WATCHLIST_ALLOWED_HOSTS añade otros (p. ej. la IP del PC si algún día se abre a la red de casa).
 */
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  ...(process.env.WATCHLIST_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
]);

export function isAllowedHost(hostHeader: string | undefined) {
  const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '');
  return ALLOWED_HOSTS.has(host);
}

export async function buildApp(services: Services, { logLevel = 'warn', web = null as WebSource | null } = {}) {
  const app = Fastify({ logger: { level: logLevel }, bodyLimit: 5 * 1024 * 1024 });
  app.addHook('onRequest', async (req, reply) => {
    if (!isAllowedHost(req.headers.host)) return reply.code(403).send({ error: 'Origen no permitido' });
  });
  app.setErrorHandler(errorHandler);
  await registerRoutes(app, services);
  if (web) await serveDir(app, web.root);
  return app;
}

/** Rutas de la SPA → index.html; API o ficheros inexistentes → 404 real. */
async function serveDir(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, { root });
  app.setNotFoundHandler((req, reply) => {
    const p = req.url.split('?')[0]!;
    if (p.startsWith('/api/') || /\.[a-z0-9]+$/i.test(p)) return reply.code(404).send({ error: 'No encontrado' });
    return reply.sendFile('index.html');
  });
}
