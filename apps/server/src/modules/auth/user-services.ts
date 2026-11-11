import { schemaDatabase } from '../../db/scoped.ts';
import { createServicesFromDb, type Services } from '../../services.ts';
import type { Accounts } from './accounts.ts';

export class UserServices {
  private cache = new Map<string, Services>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(private owner: Services) {}

  forSchema(schema: string, accountId?: string) {
    if (schema === 'public') {
      this.owner.push.accountId = accountId ?? null;
      return this.owner;
    }
    let services = this.cache.get(schema);
    if (!services) {
      const db = schemaDatabase(this.owner.db, schema);
      services = createServicesFromDb(db, { market: this.owner.market, push: this.owner.push.forDatabase(db) });
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(schema, services);
    }
    services.push.accountId = accountId ?? null;
    return services;
  }

  start(accounts: Accounts | null) {
    const loop = async () => {
      try {
        const entries = accounts ? await accounts.all() : [{ db_schema: 'public', id: undefined }];
        for (const account of entries) {
          if (this.stopped) break;
          const services = this.forSchema(account.db_schema, account.id);
          try {
            const interval = Math.max(60, (await services.settings.get()).refreshSeconds) * 1000;
            const last = await services.state.get<number>('account-alert-check', 0);
            if (Date.now() - last < interval) continue;
            await services.alerts.tick();
            await services.state.set('account-alert-check', Date.now());
          } catch (error) { console.warn('[avisos] No se pudo comprobar una cuenta', error); }
        }
      } catch (error) { console.warn('[avisos] No se pudieron cargar las cuentas', error); }
      if (!this.stopped) this.timer = setTimeout(() => { this.running = loop(); }, 60_000);
    };
    this.timer = setTimeout(() => { this.running = loop(); }, 5_000);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
