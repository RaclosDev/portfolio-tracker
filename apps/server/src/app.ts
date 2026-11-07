import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler, registerRoutes } from './routes.ts';
import type { Services } from './services.ts';

/** Carpeta con el frontend compilado (apps/web/dist). */
export type WebSource = { kind: 'dir'; root: string };

export async function buildApp(services: Services, { logLevel = 'warn', web = null as WebSource | null } = {}) {
  const app = Fastify({ logger: { level: logLevel }, bodyLimit: 5 * 1024 * 1024 });
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
