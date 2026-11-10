import fs from 'node:fs';
import { buildApp } from './app.ts';
import { config } from './config.ts';
import { createServices } from './services.ts';

/** Arranca la web completa: API, frontend y la vigilancia de precios con sus avisos. */
export async function startServer() {
  if (config.production && !config.appPassword) {
    throw new Error('Falta APP_PASSWORD: sin contraseña la web quedaría abierta a cualquiera.');
  }
  const services = await createServices({
    log: (msg, err) => console.warn(`[watchlist] ${msg}${err ? `: ${err instanceof Error ? err.message : err}` : ''}`),
  });

  // Primer arranque en local: si hay datos de ejemplo y la base está vacía, se cargan.
  if (fs.existsSync(config.seedFile) && (await services.lists.all()).every((l) => l.itemCount === 0)) {
    await services.backup.import(JSON.parse(fs.readFileSync(config.seedFile, 'utf8')));
  }

  const app = await buildApp(services, {
    logLevel: config.production ? 'info' : 'warn',
    webRoot: fs.existsSync(config.webDist) ? config.webDist : null,
    auth: {
      password: config.appPassword,
      ownerEmail: config.ownerEmail,
      secret: config.sessionSecret,
      secure: config.production,
      google: config.googleClientId && config.googleClientSecret && config.publicUrl ? {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        publicUrl: config.publicUrl,
      } : undefined,
    },
  });
  await app.listen({ host: config.host, port: config.port });
  services.alerts.start();

  console.log(`\n  Watchlist en marcha → http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`  Base de datos: ${config.databaseUrl ? 'PostgreSQL (DATABASE_URL)' : `PGlite en ${config.dataDir}`}`);
  if (!config.appPassword) console.log('  Sin APP_PASSWORD: no se pide contraseña (solo para desarrollo).');
  if (!services.push.enabled) console.log('  Sin claves VAPID: las notificaciones están desactivadas (npm run claves-push).');
  console.log('');

  return {
    close: async () => {
      services.alerts.stop();
      await app.close();
      await services.db.close();
    },
  };
}
