/**
 * Carga datos (por defecto seed/watchlist.seed.json) en la base de datos.
 *   npm run seed            → solo si no hay valores todavía
 *   npm run seed -- --force → reemplaza todo lo existente
 *   npm run seed -- ruta.json [--force] → importa otro fichero de copia
 * Usa DATABASE_URL si está definida (Neon); si no, la base local de desarrollo.
 */
import fs from 'node:fs';
import { config } from '../src/config.ts';
import { createServices } from '../src/services.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = args.find((a) => !a.startsWith('--')) ?? config.seedFile;

const s = await createServices();
const hasItems = (await s.lists.all()).some((l) => l.itemCount > 0);
if (hasItems && !force) {
  console.log('La base de datos ya tiene valores. Usa --force para reemplazarlos.');
} else {
  const res = await s.backup.import(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`Importadas ${res.lists} lista(s) con ${res.items} valores y ${res.operations} operaciones de cartera desde ${file}`);
}
await s.db.close();
