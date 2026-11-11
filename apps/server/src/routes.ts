import {
  bulkBrokerSchema,
  carteraImportSchema,
  importRequestSchema,
  instrumentInputSchema,
  instrumentPatchSchema,
  itemInputSchema,
  itemPatchSchema,
  listInputSchema,
  operationInputSchema,
  settingsSchema,
} from '@watchlist/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from './config.ts';
import { ItemsRepository } from './modules/items/items.repository.ts';
import { InstrumentsRepository, OperationsRepository } from './modules/portfolio/cartera.repository.ts';
import { PortfolioService } from './modules/portfolio/portfolio.service.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const forceQuery = z.object({ force: z.enum(['1', 'true']).optional() });
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

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async (req) => ({ ok: true, provider: req.services.market.providerId, version: config.version }));

  // Ajustes
  app.get('/api/settings', async (req) => req.services.settings.get());
  app.put('/api/settings', async (req) => req.services.settings.update(settingsSchema.partial().parse(req.body)));

  // Listas
  app.get('/api/lists', async (req) => req.services.lists.all());
  app.post('/api/lists', async (req, reply) => {
    const { name } = listInputSchema.parse(req.body);
    reply.code(201);
    return req.services.lists.create(name);
  });
  app.patch('/api/lists/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { name } = listInputSchema.parse(req.body);
    return (await req.services.lists.rename(id, name)) ?? Promise.reject(notFound('Lista'));
  });
  app.delete('/api/lists/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if ((await req.services.lists.count()) <= 1) throw new HttpError(400, 'Debe quedar al menos una lista');
    if (!(await req.services.lists.delete(id))) throw notFound('Lista');
    reply.code(204);
  });
  app.get('/api/lists/:id/watchlist', async (req) => {
    const { id } = idParam.parse(req.params);
    const { force } = forceQuery.parse(req.query);
    return (await req.services.watchlist.view(id, { force: !!force })) ?? Promise.reject(notFound('Lista'));
  });

  /**
   * Importación desde Excel/CSV a una lista: si el valor ya está, se actualizan solo los campos que
   * trae el fichero; si no, se crea. Todo o nada.
   */
  app.post('/api/lists/:id/import', async (req) => {
    const { id } = idParam.parse(req.params);
    if (!(await req.services.lists.byId(id))) throw notFound('Lista');
    const { items } = importRequestSchema.parse(req.body);
    return req.services.db.tx(async (t) => {
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
    if (!(await req.services.lists.byId(data.listId))) throw notFound('Lista');
    reply.code(201);
    return req.services.items.create(data);
  });
  app.patch('/api/items/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = await req.services.items.byId(id);
    if (!current) throw notFound('Valor');
    const patch = itemPatchSchema.parse(req.body);
    const { id: _id, createdAt, updatedAt, ...rest } = current;
    return req.services.items.update(id, itemInputSchema.parse({ ...rest, ...patch }));
  });
  app.delete('/api/items/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await req.services.items.delete(id))) throw notFound('Valor');
    reply.code(204);
  });

  // Cartera real: registro de operaciones
  app.get('/api/portfolio', async (req) => {
    const { force } = forceQuery.parse(req.query);
    return req.services.portfolio.view({ force: !!force });
  });
  /** Alta de una operación. Crea el valor si es nuevo; falla si el registro deja de cuadrar. */
  app.post('/api/operations', async (req, reply) => {
    const body = z
      .object({ operation: z.unknown(), instrument: instrumentInputSchema.partial().optional() })
      .parse(req.body);
    const data = operationInputSchema.parse(body.operation);
    const created = await req.services.db.tx(async (t) => {
      const ops = new OperationsRepository(t);
      const op = await ops.create(data);
      PortfolioService.assertValid(await ops.all());
      await new InstrumentsRepository(t).ensure({ ...body.instrument, ticker: data.ticker });
      return op;
    });
    reply.code(201);
    return created;
  });
  app.put('/api/operations/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = operationInputSchema.parse(req.body);
    return req.services.db.tx(async (t) => {
      const ops = new OperationsRepository(t);
      const op = await ops.update(id, data);
      if (!op) throw notFound('Operación');
      PortfolioService.assertValid(await ops.all());
      await new InstrumentsRepository(t).ensure({ ticker: data.ticker });
      return op;
    });
  });
  app.delete('/api/operations/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await req.services.db.tx(async (t) => {
      const ops = new OperationsRepository(t);
      if (!(await ops.delete(id))) throw notFound('Operación');
      PortfolioService.assertValid(await ops.all());
    });
    reply.code(204);
  });
  /** Cambia el bróker de varias operaciones a la vez. */
  app.post('/api/operations/broker', async (req) => {
    const { ids, broker, needsReview } = bulkBrokerSchema.parse(req.body);
    return { updated: await req.services.operations.setBroker(ids, broker, needsReview) };
  });
  app.put('/api/instruments/:ticker', async (req) => {
    const { ticker } = z.object({ ticker: z.string().min(1).max(32) }).parse(req.params);
    const current = await req.services.instruments.byTicker(ticker.toUpperCase());
    if (!current) throw notFound('Valor');
    return req.services.instruments.upsert({ ...current, ...instrumentPatchSchema.parse(req.body) });
  });
  /**
   * Importación del Excel: sustituye todo lo importado antes (las operaciones manuales se quedan) y
   * antes guarda una copia. Los valores que ya existen conservan lo editado a mano.
   */
  app.post('/api/portfolio/import', async (req) => {
    const data = carteraImportSchema.parse(req.body);
    return req.services.db.tx(async (t) => {
      const saved = await req.services.backup.snapshot('antes de importar la cartera', t, { skipIfEmpty: true });
      const ops = new OperationsRepository(t);
      const instruments = new InstrumentsRepository(t);
      const replaced = await ops.deleteAll('excel');
      for (const op of data.operations) await ops.create({ ...op, source: 'excel' });
      PortfolioService.assertValid(await ops.all());
      for (const i of data.instruments) {
        const cur = await instruments.byTicker(i.ticker.toUpperCase());
        // Símbolo y divisa, los del diálogo de importación; nombre, sector y notas, los ya guardados.
        await instruments.upsert({
          ...i,
          name: cur?.name ?? i.name,
          sector: cur?.sector ?? i.sector,
          isin: cur?.isin ?? i.isin,
          notes: cur?.notes ?? i.notes,
        });
      }
      for (const op of data.operations) await instruments.ensure({ ticker: op.ticker });
      return { imported: data.operations.length, replaced, savedTo: saved ? saved.id : null };
    });
  });

  // Mercado
  app.get('/api/market/search', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(req.query);
    return req.services.market.search(q);
  });
  app.get('/api/market/quote/:symbol', async (req) => {
    const { symbol } = z.object({ symbol: z.string().min(1).max(32) }).parse(req.params);
    const sym = symbol.toUpperCase();
    const quote = (await req.services.market.getQuotes([sym])).get(sym);
    if (!quote) throw new HttpError(404, `Símbolo ${sym} no encontrado en ${req.services.market.providerId}`);
    return quote;
  });
  /** Varias cotizaciones de una vez (los símbolos que no existen no vienen en la respuesta). */
  app.get('/api/market/quotes', async (req) => {
    const { symbols } = z.object({ symbols: z.string().min(1).max(4000) }).parse(req.query);
    const list = [...new Set(symbols.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))].slice(0, 300);
    return [...(await req.services.market.getQuotes(list)).values()];
  });
  app.get('/api/market/fx', async (req) => {
    const { currencies } = z.object({ currencies: z.string().min(1).max(100) }).parse(req.query);
    return req.services.market.getFxRates((await req.services.settings.get()).baseCurrency, currencies.split(','));
  });
  // Históricos para la ficha de detalle y minigráficos de la tabla
  app.get('/api/market/history/:symbol', async (req) => {
    const { symbol } = z.object({ symbol: z.string().min(1).max(32) }).parse(req.params);
    const { range } = z.object({ range: z.enum(['1m', '3m', '6m', '1y', '5y']).default('1y') }).parse(req.query);
    return req.services.market.getHistory(symbol.toUpperCase(), range);
  });
  app.get('/api/market/sparklines', async (req) => {
    const { symbols, range } = z
      .object({ symbols: z.string().min(1).max(2000), range: z.enum(['3m', '1y']).default('3m') })
      .parse(req.query);
    return req.services.market.getSparklines(
      symbols.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 100),
      range,
    );
  });

  // Avisos: historial y comprobación manual
  app.get('/api/alerts', async (req) => req.services.alerts.history());
  app.post('/api/alerts/check', async (req) => {
    const alerts = await req.services.alerts.tick(new Date(), { force: true });
    return { alerts: alerts.length };
  });

  // Notificaciones (Web Push)
  app.get('/api/push/key', async (req) => ({ publicKey: req.services.push.publicKey, enabled: req.services.push.enabled }));
  app.get('/api/push/devices', async (req) => req.services.push.devices());
  app.post('/api/push/subscribe', async (req, reply) => {
    if (!req.services.push.enabled) throw new HttpError(503, 'Las notificaciones no están configuradas en el servidor.');
    const { subscription, label } = pushSubscriptionSchema.parse(req.body);
    await req.services.push.subscribe(subscription, label);
    reply.code(201);
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await req.services.push.unsubscribe(endpoint);
    return { ok: true };
  });
  app.delete('/api/push/devices/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await req.services.push.remove(id))) throw notFound('Dispositivo');
    reply.code(204);
  });
  app.post('/api/push/test', async (req) =>
    req.services.push.sendAll({ title: 'Watchlist', body: 'Las notificaciones funcionan en este dispositivo.', tag: 'prueba', url: '/' }),
  );

  // Copias de seguridad
  app.get('/api/backup', async (req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="watchlist-${new Date().toISOString().slice(0, 10)}.json"`);
    return req.services.backup.export();
  });
  app.post('/api/backup', async (req) => req.services.backup.import(req.body));
  app.get('/api/snapshots', async (req) => req.services.backup.listSnapshots());
  app.get('/api/snapshots/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = await req.services.backup.getSnapshot(id);
    if (!data) throw notFound('Copia');
    reply.header('Content-Disposition', `attachment; filename="watchlist-copia-${id}.json"`);
    return data;
  });
  app.post('/api/snapshots/:id/restore', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = await req.services.backup.getSnapshot(id);
    if (!data) throw notFound('Copia');
    return req.services.backup.import(data);
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
