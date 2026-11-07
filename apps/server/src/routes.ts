import {
  importRequestSchema,
  itemInputSchema,
  itemPatchSchema,
  listInputSchema,
  positionInputSchema,
  positionPatchSchema,
  settingsSchema,
} from '@watchlist/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from './config.ts';
import { ItemsRepository } from './modules/items/items.repository.ts';
import { PositionsRepository } from './modules/portfolio/positions.repository.ts';
import type { Services } from './services.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const forceQuery = z.object({ force: z.enum(['1', 'true']).optional() });
const tradeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('buy'),
    shares: z.number().positive(),
    price: z.number().positive(),
    costBase: z.number().positive().nullable().default(null),
  }),
  z.object({ type: z.literal('sell'), shares: z.number().positive() }),
]);
const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
  label: z.string().trim().max(60).nullable().default(null),
});

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
  app.get('/api/health', async () => ({ ok: true, provider: s.market.providerId, version: config.version }));

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
    return (await s.lists.rename(id, name)) ?? Promise.reject(notFound('Lista'));
  });
  app.delete('/api/lists/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if ((await s.lists.count()) <= 1) throw new HttpError(400, 'Debe quedar al menos una lista');
    if (!(await s.lists.delete(id))) throw notFound('Lista');
    reply.code(204);
  });
  app.get('/api/lists/:id/watchlist', async (req) => {
    const { id } = idParam.parse(req.params);
    const { force } = forceQuery.parse(req.query);
    return (await s.watchlist.view(id, { force: !!force })) ?? Promise.reject(notFound('Lista'));
  });

  /**
   * Importación desde Excel/CSV a una lista: si el valor ya está, se actualizan solo los campos que
   * trae el fichero; si no, se crea. Todo o nada.
   */
  app.post('/api/lists/:id/import', async (req) => {
    const { id } = idParam.parse(req.params);
    if (!(await s.lists.byId(id))) throw notFound('Lista');
    const { items } = importRequestSchema.parse(req.body);
    return s.db.tx(async (t) => {
      const repo = new ItemsRepository(t);
      const existing = new Map((await repo.byList(id)).map((i) => [i.symbol, i]));
      let created = 0;
      let updated = 0;
      for (const row of items) {
        const current = existing.get(row.symbol);
        if (current) {
          const { id: itemId, createdAt, updatedAt, ...rest } = current;
          await repo.update(itemId, itemInputSchema.parse({ ...rest, ...row, listId: id }));
          updated++;
        } else {
          const item = await repo.create(itemInputSchema.parse({ ...row, listId: id }));
          existing.set(item.symbol, item);
          created++;
        }
      }
      return { created, updated };
    });
  });

  // Valores
  app.post('/api/items', async (req, reply) => {
    const data = itemInputSchema.parse(req.body);
    if (!(await s.lists.byId(data.listId))) throw notFound('Lista');
    reply.code(201);
    return s.items.create(data);
  });
  app.patch('/api/items/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = await s.items.byId(id);
    if (!current) throw notFound('Valor');
    const patch = itemPatchSchema.parse(req.body);
    const { id: _id, createdAt, updatedAt, ...rest } = current;
    return s.items.update(id, itemInputSchema.parse({ ...rest, ...patch }));
  });
  app.delete('/api/items/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await s.items.delete(id))) throw notFound('Valor');
    reply.code(204);
  });

  // Cartera real
  app.get('/api/portfolio', async (req) => {
    const { force } = forceQuery.parse(req.query);
    return s.portfolio.view({ force: !!force });
  });
  app.post('/api/positions', async (req, reply) => {
    const data = positionInputSchema.parse(req.body);
    if (await s.positions.bySymbol(data.symbol)) {
      throw new HttpError(409, `${data.symbol} ya está en la cartera: usa «Comprar» en su fila.`);
    }
    reply.code(201);
    return s.positions.create(data);
  });
  app.patch('/api/positions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = await s.positions.byId(id);
    if (!current) throw notFound('Posición');
    const patch = positionPatchSchema.parse(req.body);
    const { id: _id, createdAt, updatedAt, ...rest } = current;
    const next = positionInputSchema.parse({ ...rest, ...patch });
    const clash = await s.positions.bySymbol(next.symbol);
    if (clash && clash.id !== id) throw new HttpError(409, `${next.symbol} ya está en la cartera.`);
    return s.positions.update(id, next);
  });
  /** Compra o venta sobre una posición: recalcula acciones y precio medio. Si se vende todo, se borra. */
  app.post('/api/positions/:id/trade', async (req) => {
    const { id } = idParam.parse(req.params);
    const t = tradeSchema.parse(req.body);
    return s.db.tx(async (db) => {
      const repo = new PositionsRepository(db);
      const current = await repo.byId(id);
      if (!current) throw notFound('Posición');
      const { id: _id, createdAt, updatedAt, ...rest } = current;
      if (t.type === 'sell') {
        if (t.shares > current.shares + 1e-9) throw new HttpError(400, `Solo tienes ${current.shares} acciones.`);
        const left = current.shares - t.shares;
        if (left < 1e-9) {
          await repo.delete(id);
          return { deleted: true };
        }
        // El precio medio no cambia al vender; el coste en divisa base, en proporción.
        const costBase = current.costBase != null ? (current.costBase * left) / current.shares : null;
        return repo.update(id, positionInputSchema.parse({ ...rest, shares: left, costBase }));
      }
      const shares = current.shares + t.shares;
      const avgPrice = (current.shares * current.avgPrice + t.shares * t.price) / shares;
      // El coste en divisa base solo se mantiene si se conoce el de las dos compras.
      const costBase = current.costBase != null && t.costBase != null ? current.costBase + t.costBase : null;
      return repo.update(id, positionInputSchema.parse({ ...rest, shares, avgPrice, costBase }));
    });
  });
  app.delete('/api/positions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await s.positions.delete(id))) throw notFound('Posición');
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
  /** Varias cotizaciones de una vez (los símbolos que no existen no vienen en la respuesta). */
  app.get('/api/market/quotes', async (req) => {
    const { symbols } = z.object({ symbols: z.string().min(1).max(4000) }).parse(req.query);
    const list = [...new Set(symbols.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))].slice(0, 300);
    return [...(await s.market.getQuotes(list)).values()];
  });
  app.get('/api/market/fx', async (req) => {
    const { currencies } = z.object({ currencies: z.string().min(1).max(100) }).parse(req.query);
    return s.market.getFxRates((await s.settings.get()).baseCurrency, currencies.split(','));
  });
  // Históricos para la ficha de detalle y minigráficos de la tabla
  app.get('/api/market/history/:symbol', async (req) => {
    const { symbol } = z.object({ symbol: z.string().min(1).max(32) }).parse(req.params);
    const { range } = z.object({ range: z.enum(['1m', '3m', '6m', '1y', '5y']).default('1y') }).parse(req.query);
    return s.market.getHistory(symbol.toUpperCase(), range);
  });
  app.get('/api/market/sparklines', async (req) => {
    const { symbols } = z.object({ symbols: z.string().min(1).max(2000) }).parse(req.query);
    return s.market.getSparklines(symbols.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 100));
  });

  // Avisos: historial y comprobación manual
  app.get('/api/alerts', async () => s.alerts.history());
  app.post('/api/alerts/check', async () => {
    const alerts = await s.alerts.tick(new Date(), { force: true });
    return { alerts: alerts.length };
  });

  // Notificaciones (Web Push)
  app.get('/api/push/key', async () => ({ publicKey: s.push.publicKey, enabled: s.push.enabled }));
  app.get('/api/push/devices', async () => s.push.devices());
  app.post('/api/push/subscribe', async (req, reply) => {
    if (!s.push.enabled) throw new HttpError(503, 'Las notificaciones no están configuradas en el servidor.');
    const { subscription, label } = pushSubscriptionSchema.parse(req.body);
    await s.push.subscribe(subscription, label);
    reply.code(201);
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await s.push.unsubscribe(endpoint);
    return { ok: true };
  });
  app.delete('/api/push/devices/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await s.push.remove(id))) throw notFound('Dispositivo');
    reply.code(204);
  });
  app.post('/api/push/test', async () =>
    s.push.sendAll({ title: 'Watchlist', body: 'Las notificaciones funcionan en este dispositivo.', tag: 'prueba', url: '/' }),
  );

  // Copias de seguridad
  app.get('/api/backup', async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="watchlist-${new Date().toISOString().slice(0, 10)}.json"`);
    return s.backup.export();
  });
  app.post('/api/backup', async (req) => s.backup.import(req.body));
  app.get('/api/snapshots', async () => s.backup.listSnapshots());
  app.get('/api/snapshots/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = await s.backup.getSnapshot(id);
    if (!data) throw notFound('Copia');
    reply.header('Content-Disposition', `attachment; filename="watchlist-copia-${id}.json"`);
    return data;
  });
  app.post('/api/snapshots/:id/restore', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = await s.backup.getSnapshot(id);
    if (!data) throw notFound('Copia');
    return s.backup.import(data);
  });
}

export function errorHandler(err: unknown, _req: unknown, reply: import('fastify').FastifyReply) {
  if (err instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'Datos no válidos',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const e = err as { statusCode?: number; message?: string; code?: string };
  // Postgres: valor repetido (p. ej. una lista con el mismo nombre).
  if (e.code === '23505') return reply.code(409).send({ error: 'Ya existe uno con ese nombre o símbolo' });
  const code = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
  if (code >= 500) reply.log.error(err);
  return reply.code(code).send({ error: code >= 500 ? 'Error interno' : e.message });
}
