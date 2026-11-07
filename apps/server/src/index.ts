import fs from 'node:fs';
import { config } from './config.ts';
import { startServer } from './server.ts';

// Arranque con npm (dev/start). El frontend se sirve desde apps/web/dist si está compilado.
const server = await startServer({
  web: fs.existsSync(config.webDist) ? { kind: 'dir', root: config.webDist } : null,
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
