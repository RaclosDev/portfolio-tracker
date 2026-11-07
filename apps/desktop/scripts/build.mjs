// Compila el proceso principal de Electron (TypeScript → un único main.mjs).
// Nuestro código (servidor + shared) va dentro; las librerías npm se cargan de node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const serverPkg = JSON.parse(readFileSync(path.join(root, '../server/package.json'), 'utf8'));
const external = ['electron', ...Object.keys(serverPkg.dependencies).filter((d) => !d.startsWith('@watchlist/'))];

await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(root, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: 'inline',
  logLevel: 'warning',
});
