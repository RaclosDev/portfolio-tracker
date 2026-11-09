import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth, type AuthOptions } from './modules/auth/auth.ts';
import { errorHandler, registerRoutes } from './routes.ts';
import type { Services } from './services.ts';

export interface AppOptions {
  logLevel?: string;
  /** Carpeta con el frontend compilado (apps/web/dist). */
  webRoot?: string | null;
  auth?: AuthOptions;
}

export async function buildApp(services: Services, { logLevel = 'warn', webRoot = null, auth }: AppOptions = {}) {
  // trustProxy: en Render la petición llega a través de su proxy (IP real en X-Forwarded-For).
  const app = Fastify({ logger: { level: logLevel }, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // React usa estilos en línea (style={...}) para anchos y posiciones calculados.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        // read-excel-file descomprime el .xlsx en workers creados desde blob:; sin esto la lectura se cuelga sin error.
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // Las notificaciones abren la app desde el service worker: no hace falta aislar más.
    crossOriginEmbedderPolicy: false,
  });
  app.setErrorHandler(errorHandler);
  registerAuth(app, auth ?? { password: null, secret: null, secure: false });
  await registerRoutes(app, services);
  if (webRoot) await serveDir(app, webRoot);
  return app;
}

/** Rutas de la SPA → index.html; API o ficheros inexistentes → 404 real. */
async function serveDir(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, {
    root,
    // Los ficheros con hash (assets/) no cambian nunca; index.html y el service worker, siempre frescos.
    setHeaders: (res, file) => {
      res.header('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    const p = req.url.split('?')[0]!;
    if (p.startsWith('/api/') || /\.[a-z0-9]+$/i.test(p)) return reply.code(404).send({ error: 'No encontrado' });
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });
}
