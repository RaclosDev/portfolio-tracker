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
// 'data' = base de datos del modo navegador de desarrollo (apps/server/data).
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'datos', 'data', '.git', '.claude', '.vscode']);
/** Con la versión compilada, las carpetas dist sí vienen en el paquete y se sincronizan. */
const SKIP_DIRS_BUILD = new Set([...SKIP_DIRS].filter((d) => d !== 'dist'));
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

function walk(root, skip, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) walk(root, skip, r, out);
    } else if (entry.isFile() && !KEEP_FILES.has(r)) {
      out.push(r);
    }
  }
  return out;
}

/** Borra las carpetas que se han quedado vacías (p. ej. el código fuente al pasar a la versión compilada). */
function removeEmptyDirs(dir, skip, isRoot = true) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !skip.has(entry.name)) removeEmptyDirs(path.join(dir, entry.name), skip, false);
  }
  if (!isRoot && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * Copia el código de `src` a `dst` y borra en `dst` lo que ya no existe (sin tocar dependencias ni datos).
 * `withBuild`: `src` es una versión compilada y también trae las carpetas dist.
 */
export function mirror(src, dst, { withBuild = false } = {}) {
  const skip = withBuild ? SKIP_DIRS_BUILD : SKIP_DIRS;
  fs.mkdirSync(dst, { recursive: true });
  const srcFiles = walk(src, skip);
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
  for (const rel of walk(dst, skip)) {
    if (!keep.has(rel)) {
      fs.rmSync(path.join(dst, rel), { force: true });
      removed++;
    }
  }
  removeEmptyDirs(dst, skip);
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

/** Versión compilada: solo dependencias de ejecución (Electron); borra las de compilación que hubiera. */
export function runtimeInstall(root, opts) {
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], root, opts);
}

/** ¿La carpeta tiene una versión compilada (descargada de GitHub) en vez del código fuente? */
export const isBuildTree = (root) => fs.existsSync(path.join(root, 'build-info.json'));

/** ¿Está todo lo necesario para abrir la app? */
export const hasBuild = (root) =>
  fs.existsSync(path.join(root, 'apps/web/dist/index.html')) && fs.existsSync(path.join(root, 'apps/desktop/dist/main.mjs'));

/** Instala las dependencias que pida esa versión y deja la app lista para abrir. Devuelve su huella. */
export function prepareTree(root, { quiet = false, previousHash = null } = {}) {
  const deps = depsHash(root);
  const build = isBuildTree(root);
  if (deps !== previousHash || !fs.existsSync(path.join(root, 'node_modules'))) {
    log(build ? 'Instalando el motor de la ventana (Electron)…' : 'Las dependencias han cambiado: npm install…');
    (build ? runtimeInstall : npmInstall)(root, { quiet });
  }
  electronPath(root); // descarga el binario de Electron ahora si falta, no al abrir
  if (!build) buildApp(root, { quiet });
  return deps;
}

/** Ruta del ejecutable de Electron; si aún no se ha descargado (~100 MB), lo descarga ahora. */
export function electronPath(root) {
  return createRequire(path.join(root, 'package.json'))('electron');
}

/** Reintenta una vez: justo tras npm install, el antivirus a veces bloquea ficheros recién creados. */
function runWithRetry(cmd, args, cwd, opts) {
  try {
    run(cmd, args, cwd, opts);
  } catch {
    log('Reintentando…');
    spawnSync(process.platform === 'win32' ? 'timeout /t 3 /nobreak >nul' : 'sleep 3', { shell: true });
    run(cmd, args, cwd, opts);
  }
}

export function buildApp(root, opts) {
  runWithRetry('npm', ['run', 'build', '-w', '@watchlist/web'], root, opts);
  runWithRetry('npm', ['run', 'build', '-w', '@watchlist/desktop'], root, opts);
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

/**
 * ¿Ese commit ha pasado la verificación de GitHub Actions (job «verificar»)?
 * Solo se instalan versiones verificadas: un push roto nunca llega a los PCs.
 */
export async function passedVerification({ repo }, sha) {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?check_name=verificar`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'watchlist-desktop-app' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return (data.check_runs ?? []).some((r) => r.status === 'completed' && r.conclusion === 'success');
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

/** Nombre de la versión compilada de un commit en GitHub Releases (la publica la CI). */
export const BUILD_ASSET = 'watchlist-app.zip';
export const buildTag = (sha) => `build-${sha.slice(0, 12)}`;

/**
 * Descarga la versión compilada de un commit. Devuelve null si no existe (versiones antiguas o si
 * la CI no la publicó): entonces se usa el código fuente y se compila en el PC como antes.
 */
export async function downloadBuild({ repo }, sha) {
  const res = await fetch(`https://github.com/${repo}/releases/download/${buildTag(sha)}/${BUILD_ASSET}`, {
    headers: { 'User-Agent': 'watchlist-desktop-app' },
    signal: AbortSignal.timeout(120_000),
    redirect: 'follow',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`descarga fallida (${res.status})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-build-'));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  const zip = path.join(tmp, BUILD_ASSET);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const out = path.join(tmp, 'app');
  fs.mkdirSync(out);
  const unzip =
    process.platform === 'linux' ? spawnSync('unzip', ['-q', zip, '-d', out]) : spawnSync(TAR, ['-xf', zip, '-C', out]);
  if (unzip.status !== 0 || !hasBuild(out) || !isBuildTree(out)) {
    cleanup();
    throw new Error('el paquete descargado no es válido');
  }
  return { dir: out, cleanup };
}

/** Descarga un commit: la versión compilada si existe; si no, el código fuente. */
export async function downloadRelease(cfg, sha) {
  const build = await downloadBuild(cfg, sha).catch((err) => {
    log(`Sin versión compilada (${err.message}); se usa el código fuente.`);
    return null;
  });
  if (build) return { ...build, withBuild: true };
  return { ...(await downloadCommit(cfg, sha)), withBuild: false };
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
