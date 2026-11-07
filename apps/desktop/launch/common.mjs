// Utilidades compartidas por el instalador (install.mjs) y el lanzador (launch.mjs).
// Solo usa módulos de Node: funciona antes de que existan las dependencias.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Carpeta de instalación en este PC (fuera de cualquier carpeta sincronizada):
 *   <home>/node  → Node.js propio de la app (lo descarga el instalador)
 *   <home>/app   → el programa
 * WATCHLIST_HOME permite cambiarla (pruebas).
 */
export function watchlistHome() {
  if (process.env.WATCHLIST_HOME) return path.resolve(process.env.WATCHLIST_HOME);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Watchlist');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Watchlist');
  return path.join(os.homedir(), '.local', 'share', 'watchlist');
}

export function localAppRoot() {
  return path.join(watchlistHome(), 'app');
}

export const CONFIG_FILE = 'watchlist.local.json';
/** Nunca se copian ni se borran al sincronizar código. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'datos', '.git', '.claude', '.vscode']);
const KEEP_FILES = new Set([CONFIG_FILE]);

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const log = (...args) => console.log(`[${new Date().toLocaleTimeString('es-ES')}]`, ...args);

function walk(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, r, out);
    } else if (entry.isFile() && !KEEP_FILES.has(r)) {
      out.push(r);
    }
  }
  return out;
}

/** Copia el código de `src` a `dst` y borra en `dst` lo que ya no existe (sin tocar dependencias ni datos). */
export function mirror(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const srcFiles = walk(src);
  const keep = new Set(srcFiles);
  let copied = 0;
  for (const rel of srcFiles) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    const a = fs.statSync(from);
    const b = fs.existsSync(to) ? fs.statSync(to) : null;
    if (b && b.size === a.size && fs.readFileSync(from).equals(fs.readFileSync(to))) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
  let removed = 0;
  for (const rel of walk(dst)) {
    if (!keep.has(rel)) {
      fs.rmSync(path.join(dst, rel), { force: true });
      removed++;
    }
  }
  return { copied, removed };
}

/** Huella de las dependencias: si cambia hay que volver a ejecutar npm install. */
export function depsHash(root) {
  const h = crypto.createHash('sha1');
  const files = ['package-lock.json', 'package.json'];
  for (const dir of ['apps', 'packages']) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base).sort()) files.push(`${dir}/${name}/package.json`);
  }
  for (const f of files) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) h.update(f).update(fs.readFileSync(p));
  }
  return h.digest('hex');
}

/** Ejecuta un comando y espera. Lanza error si falla. */
export function run(cmd, args, cwd, { quiet = false } = {}) {
  // En Windows npm es un .cmd y necesita shell; los argumentos son fijos (sin datos del usuario).
  const res =
    process.platform === 'win32'
      ? spawnSync([cmd, ...args].join(' '), { cwd, stdio: quiet ? 'pipe' : 'inherit', shell: true, encoding: 'utf8' })
      : spawnSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (res.status !== 0) {
    const out = quiet ? `\n${res.stdout ?? ''}${res.stderr ?? ''}` : '';
    throw new Error(`Falló: ${cmd} ${args.join(' ')} (código ${res.status})${out}`);
  }
}

export function npmInstall(root, opts) {
  run('npm', ['install', '--no-audit', '--no-fund'], root, opts);
}

/** Ruta del ejecutable de Electron; si aún no se ha descargado (~100 MB), lo descarga ahora. */
export function electronPath(root) {
  return createRequire(path.join(root, 'package.json'))('electron');
}

export function buildApp(root, opts) {
  run('npm', ['run', 'build', '-w', '@watchlist/web'], root, opts);
  run('npm', ['run', 'build', '-w', '@watchlist/desktop'], root, opts);
}

/** tar de Windows (bsdtar, sabe de .zip); evita el tar de Git si está antes en el PATH. */
export const TAR =
  process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/* ---------------- GitHub ---------------- */

/** Último commit de la rama configurada: { sha, date } o null si no hay conexión/configuración. */
export async function latestCommit({ repo, branch }) {
  if (!repo) return null;
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'watchlist-desktop-app' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const data = await res.json();
  return { sha: data.sha, date: data.commit?.committer?.date ?? null };
}

/** Descarga y descomprime el código de un commit. Devuelve la carpeta con el proyecto. */
export async function downloadCommit({ repo }, sha) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-update-'));
  const zip = path.join(tmp, 'codigo.zip');
  const res = await fetch(`https://codeload.github.com/${repo}/zip/${sha}`, {
    headers: { 'User-Agent': 'watchlist-desktop-app' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Descarga fallida (${res.status})`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const out = path.join(tmp, 'codigo');
  fs.mkdirSync(out);
  // tar (bsdtar) viene con Windows 10+ y macOS y descomprime .zip; en Linux se usa unzip.
  const unzip =
    process.platform === 'linux' ? spawnSync('unzip', ['-q', zip, '-d', out]) : spawnSync(TAR, ['-xf', zip, '-C', out]);
  if (unzip.status !== 0) throw new Error('No se pudo descomprimir la actualización');
  const [folder] = fs.readdirSync(out);
  return { dir: path.join(out, folder), cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/* ---------------- Aviso visual mientras se actualiza (Windows) ---------------- */

export function showUpdatingNotice() {
  if (process.platform !== 'win32') return () => {};
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$f = New-Object Windows.Forms.Form; $f.Text = "Watchlist"; $f.Width = 420; $f.Height = 130;',
    '$f.StartPosition = "CenterScreen"; $f.TopMost = $true; $f.FormBorderStyle = "FixedDialog"; $f.ControlBox = $false;',
    '$l = New-Object Windows.Forms.Label; $l.Dock = "Fill"; $l.TextAlign = "MiddleCenter";',
    '$l.Font = New-Object Drawing.Font("Segoe UI", 10);',
    '$l.Text = "Actualizando Watchlist a la nueva version...`nPuede tardar un minuto.";',
    '$f.Controls.Add($l); [void]$f.ShowDialog()',
  ].join(' ');
  const child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', () => {});
  return () => child.kill();
}
