import fs from 'node:fs';
import path from 'node:path';
import {
  ALERT_HISTORY_FILE,
  itemInputSchema,
  itemPatchSchema,
  listInputSchema,
  positionInputSchema,
  positionPatchSchema,
  settingsSchema,
  type AlertRecord,
} from '@watchlist/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from './services.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const forceQuery = z.object({ force: z.enum(['1', 'true']).optional() });
const tradeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('buy'), shares: z.number().positive(), price: z.number().positive(), costBase: z.number().positive().nullable().default(null) }),
  z.object({ type: z.literal('sell'), shares: z.number().positive() }),
]);

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

  // Cartera real
  app.get('/api/portfolio', async (req) => {
    const { force } = forceQuery.parse(req.query);
    return s.portfolio.view({ force: !!force });
  });
  app.post('/api/positions', async (req, reply) => {
    const data = positionInputSchema.parse(req.body);
    if (s.positions.bySymbol(data.symbol)) {
      throw new HttpError(409, `${data.symbol} ya está en la cartera: usa «Añadir compra» en su fila.`);
    }
    reply.code(201);
    return s.positions.create(data);
  });
  app.patch('/api/positions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = s.positions.byId(id);
    if (!current) throw notFound('Posición');
    const patch = positionPatchSchema.parse(req.body);
    const { id: _id, createdAt, updatedAt, ...rest } = current;
    const next = positionInputSchema.parse({ ...rest, ...patch });
    const clash = s.positions.bySymbol(next.symbol);
    if (clash && clash.id !== id) throw new HttpError(409, `${next.symbol} ya está en la cartera.`);
    return s.positions.update(id, next);
  });
  /** Compra o venta sobre una posición: recalcula acciones y precio medio. Si se vende todo, se borra. */
  app.post('/api/positions/:id/trade', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = s.positions.byId(id);
    if (!current) throw notFound('Posición');
    const t = tradeSchema.parse(req.body);
    const { id: _id, createdAt, updatedAt, ...rest } = current;
    if (t.type === 'sell') {
      if (t.shares > current.shares + 1e-9) throw new HttpError(400, `Solo tienes ${current.shares} acciones.`);
      const left = current.shares - t.shares;
      if (left < 1e-9) {
        s.positions.delete(id);
        return { deleted: true };
      }
      // El precio medio no cambia al vender; el coste en divisa base, en proporción.
      const costBase = current.costBase != null ? (current.costBase * left) / current.shares : null;
      return s.positions.update(id, positionInputSchema.parse({ ...rest, shares: left, costBase }));
    }
    const shares = current.shares + t.shares;
    const avgPrice = (current.shares * current.avgPrice + t.shares * t.price) / shares;
    // El coste en divisa base solo se mantiene si se conoce el de las dos compras.
    const costBase = current.costBase != null && t.costBase != null ? current.costBase + t.costBase : null;
    return s.positions.update(id, positionInputSchema.parse({ ...rest, shares, avgPrice, costBase }));
  });
  app.delete('/api/positions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!s.positions.delete(id)) throw notFound('Posición');
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

  // Historial de avisos (lo escribe la app de escritorio en la carpeta de datos)
  app.get('/api/alerts', async () => {
    if (!s.dataDir) return [];
    try {
      const all = JSON.parse(fs.readFileSync(path.join(s.dataDir, ALERT_HISTORY_FILE), 'utf8')) as AlertRecord[];
      return all.slice(-200).reverse();
    } catch {
      return [];
    }
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
