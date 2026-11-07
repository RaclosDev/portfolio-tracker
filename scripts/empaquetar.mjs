// Crea un ZIP para instalar la app en otro PC: el código publicado (git) + la lista inicial
// de valores (seed), que no está en GitHub. Sin dependencias, datos ni compilados.
// Uso: npm run empaquetar  →  ../Watchlist-instalador.zip
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(root, '..', 'Watchlist-instalador.zip');
const seed = 'apps/server/seed/watchlist.seed.json';

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
if (fs.existsSync(path.join(root, seed))) files.push(seed);

const list = path.join(os.tmpdir(), `watchlist-files-${Date.now()}.txt`);
fs.writeFileSync(list, files.join('\n'));
fs.rmSync(out, { force: true });
try {
  // tar (bsdtar) de Windows 10+ y macOS crea .zip con -a.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-a', '-c', '-f', out, '-T', list], { cwd: root, stdio: 'inherit' });
} finally {
  fs.rmSync(list, { force: true });
}
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`\n  Creado ${out} (${files.length} ficheros, ${mb} MB)`);
console.log(`  ${files.includes(seed) ? 'Incluye' : 'NO incluye'} la lista inicial de valores.`);
console.log('  Descomprímelo en el otro PC y ejecuta instalar.bat.\n');
