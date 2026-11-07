// Compila el proceso principal de Electron (TypeScript → un único main.mjs autosuficiente).
// Todo va dentro (nuestro código y las librerías npm del servidor) salvo Electron: así la app
// instalada solo necesita el paquete electron en node_modules, no las herramientas de compilación.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(root, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  // Algunas librerías son CommonJS y usan require(): en un módulo ESM hay que crearlo.
  banner: { js: "import { createRequire as __wlCreateRequire } from 'node:module'; const require = __wlCreateRequire(import.meta.url);" },
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
});
