import fs from 'node:fs';
import { buildApp, type WebSource } from './app.ts';
import type { JournalMode } from './db/database.ts';
import { config } from './config.ts';
import { createServices } from './services.ts';

export interface StartOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  journalMode?: JournalMode;
  web?: WebSource | null;
  /** Si la base de datos está vacía, carga este fichero de copia (primer arranque). */
  seedFile?: string;
  quiet?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Arranca la API (y el frontend si se indica). Lo usan `npm start` y la app de escritorio. */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const dataDir = opts.dataDir ?? config.dataDir;
  const services = createServices({
    dataDir,
    journalMode: opts.journalMode,
    log: (msg, err) => console.warn(`[mercado] ${msg}: ${err instanceof Error ? err.message : (err ?? '')}`),
  });

  if (opts.seedFile && fs.existsSync(opts.seedFile) && services.lists.all().every((l) => l.itemCount === 0)) {
    services.backup.import(JSON.parse(fs.readFileSync(opts.seedFile, 'utf8')));
  }

  const app = await buildApp(services, { web: opts.web ?? null });
  const host = opts.host ?? config.host;
  await app.listen({ host, port: opts.port ?? config.port });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? config.port);
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

  if (!opts.quiet) {
    console.log(`\n  Watchlist en marcha → ${opts.web ? url : `${url}/api (frontend: http://localhost:5173)`}`);
    console.log(`  Datos: ${dataDir}\n`);
  }

  let closed = false;
  return {
    url,
    port,
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
      services.db.close();
    },
  };
}
