// Crea un ZIP para instalar la app en otro PC: la versión publicada (último commit, con los
// saltos de línea correctos para Windows) + la lista inicial de valores (seed), que no está
// en GitHub. Sin dependencias, datos ni compilados.
// Uso: npm run empaquetar  →  ../Watchlist-instalador.zip
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(root, '..', 'Watchlist-instalador.zip');
const seed = 'apps/server/seed/watchlist.seed.json';
// tar de Windows (bsdtar, sabe de .zip); evita el tar de Git si está antes en el PATH.
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (dirty) console.warn('\n  Aviso: hay cambios sin commit; el ZIP lleva solo lo del último commit.\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-pack-'));
try {
  const tarball = path.join(tmp, 'codigo.tar');
  const dir = path.join(tmp, 'Watchlist');
  fs.mkdirSync(dir);
  execFileSync('git', ['archive', '--format=tar', '-o', tarball, 'HEAD'], { cwd: root });
  execFileSync(tar, ['-xf', tarball, '-C', dir]);
  const withSeed = fs.existsSync(path.join(root, seed));
  if (withSeed) fs.copyFileSync(path.join(root, seed), path.join(dir, seed));

  fs.rmSync(out, { force: true });
  execFileSync(tar, ['-a', '-c', '-f', out, '-C', tmp, 'Watchlist']);
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
  console.log(`\n  Creado ${out} (versión ${sha}, ${mb} MB)`);
  console.log(`  ${withSeed ? 'Incluye' : 'NO incluye'} la lista inicial de valores.`);
  console.log('  En el otro PC: descomprimir y doble clic en Watchlist\\instalar.bat.\n');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
