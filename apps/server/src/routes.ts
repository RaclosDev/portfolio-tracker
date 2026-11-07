import { itemInputSchema, itemPatchSchema, listInputSchema, settingsSchema } from '@watchlist/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from './services.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const forceQuery = z.object({ force: z.enum(['1', 'true']).optional() });

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const notFound = (what: string) => new HttpError(404, `${what} no encontrado`);

export async function registerRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/health', async () => ({
    ok: true,
    provider: s.market.providerId,
    version: process.env.WATCHLIST_VERSION ?? 'desarrollo',
  }));

  // Ajustes
  app.get('/api/settings', async () => s.settings.get());
  app.put('/api/settings', async (req) => s.settings.update(settingsSchema.partial().parse(req.body)));

  // Listas
  app.get('/api/lists', async () => s.lists.all());
  app.post('/api/lists', async (req, reply) => {
    const { name } = listInputSchema.parse(req.body);
    reply.code(201);
    return s.lists.create(name);
  });
  app.patch('/api/lists/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { name } = listInputSchema.parse(req.body);
    return s.lists.rename(id, name) ?? Promise.reject(notFound('Lista'));
  });
  app.delete('/api/lists/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (s.lists.count() <= 1) throw new HttpError(400, 'Debe quedar al menos una lista');
    if (!s.lists.delete(id)) throw notFound('Lista');
    reply.code(204);
  });
  app.get('/api/lists/:id/watchlist', async (req) => {
    const { id } = idParam.parse(req.params);
    const { force } = forceQuery.parse(req.query);
    return (await s.watchlist.view(id, { force: !!force })) ?? Promise.reject(notFound('Lista'));
  });

  // Valores
  app.post('/api/items', async (req, reply) => {
    const data = itemInputSchema.parse(req.body);
    if (!s.lists.byId(data.listId)) throw notFound('Lista');
    reply.code(201);
    return s.items.create(data);
  });
  app.patch('/api/items/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = s.items.byId(id);
    if (!current) throw notFound('Valor');
    const patch = itemPatchSchema.parse(req.body);
    const { id: _id, createdAt, updatedAt, ...rest } = current;
    return s.items.update(id, itemInputSchema.parse({ ...rest, ...patch }));
  });
  app.delete('/api/items/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!s.items.delete(id)) throw notFound('Valor');
    reply.code(204);
  });

  // Mercado
  app.get('/api/market/search', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(req.query);
    return s.market.search(q);
  });
  app.get('/api/market/quote/:symbol', async (req) => {
    const { symbol } = z.object({ symbol: z.string().min(1).max(32) }).parse(req.params);
    const sym = symbol.toUpperCase();
    const quote = (await s.market.getQuotes([sym])).get(sym);
    if (!quote) throw new HttpError(404, `Símbolo ${sym} no encontrado en ${s.market.providerId}`);
    return quote;
  });

  app.get('/api/market/fx', async (req) => {
    const { currencies } = z.object({ currencies: z.string().min(1).max(100) }).parse(req.query);
    return s.market.getFxRates(s.settings.get().baseCurrency, currencies.split(','));
  });

  // Copia de seguridad
  app.get('/api/backup', async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="watchlist-${new Date().toISOString().slice(0, 10)}.json"`);
    return s.backup.export();
  });
  app.post('/api/backup', async (req) => s.backup.import(req.body));
}

export function errorHandler(err: unknown, _req: unknown, reply: import('fastify').FastifyReply) {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'Datos no válidos',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const e = err as { statusCode?: number; message?: string };
  const code = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
  if (code >= 500) reply.log.error(err);
  return reply.code(code).send({ error: code >= 500 ? 'Error interno' : e.message });
}
