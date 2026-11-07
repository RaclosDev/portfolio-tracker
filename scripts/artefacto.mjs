// Prepara la versión compilada que descargan las apps instaladas (build/watchlist-app.zip).
// Solo lleva lo necesario para funcionar: la web compilada, el proceso principal en un único
// fichero, el lanzador y un package.json cuya única dependencia es Electron. Así los PCs no
// necesitan las herramientas de compilación (vite, esbuild, TypeScript…) ni compilar al actualizar.
// Requiere haber ejecutado antes la compilación de web y escritorio.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'build');
const stage = path.join(out, 'watchlist-app');
const zip = path.join(out, 'watchlist-app.zip');

/** Ficheros y carpetas que se copian tal cual. */
const INCLUDE = [
  'apps/web/dist',
  'apps/desktop/dist/main.mjs',
  'apps/desktop/assets',
  'apps/desktop/launch',
  'apps/desktop/src/preload.cjs',
  'apps/desktop/package.json',
  'watchlist.update.json',
  'instalar.bat',
  'instalar.ps1',
  'instalar.sh',
  'desinstalar.ps1',
  'README.md',
  '.nvmrc',
];

for (const need of ['apps/web/dist/index.html', 'apps/desktop/dist/main.mjs']) {
  if (!fs.existsSync(path.join(root, need))) throw new Error(`Falta ${need}: compila antes la web y el escritorio.`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const rel of INCLUDE) {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(stage, rel), { recursive: true });
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify(
    {
      name: rootPkg.name,
      private: true,
      version: rootPkg.version,
      description: rootPkg.description,
      type: 'module',
      engines: rootPkg.engines,
      // Versión exacta: la misma con la que se ha compilado y verificado.
      dependencies: { electron: electronVersion },
      allowScripts: { electron: true },
    },
    null,
    2,
  ) + '\n',
);

const sha = process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify({ sha, builtAt: new Date().toISOString() }, null, 2) + '\n');

// Comprimir el contenido (sin carpeta raíz). En Windows, el tar del sistema sabe hacer .zip.
const res =
  process.platform === 'win32'
    ? spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '*'], {
        cwd: stage,
        stdio: 'inherit',
        shell: false,
      })
    : spawnSync('zip', ['-q', '-r', zip, '.'], { cwd: stage, stdio: 'inherit' });
if (res.status !== 0) throw new Error('No se pudo crear el zip');
console.log(`Versión compilada: ${path.relative(root, zip)} (${(fs.statSync(zip).size / 1e6).toFixed(1)} MB, Electron ${electronVersion})`);
