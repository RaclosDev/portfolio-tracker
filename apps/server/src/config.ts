import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');

const num = (v: string | undefined, fallback: number) => (v && !Number.isNaN(+v) ? +v : fallback);

export const config = {
  /** Solo local por defecto. Usa HOST=0.0.0.0 únicamente dentro de Docker. */
  host: process.env.HOST ?? '127.0.0.1',
  port: num(process.env.PORT, 5174),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(serverRoot, 'data')),
  webDist: path.resolve(serverRoot, '../web/dist'),
  seedFile: path.join(serverRoot, 'seed', 'watchlist.seed.json'),
  quoteTtlMs: num(process.env.QUOTE_TTL_SECONDS, 45) * 1000,
  targetsTtlMs: num(process.env.TARGETS_TTL_HOURS, 12) * 3_600_000,
};
