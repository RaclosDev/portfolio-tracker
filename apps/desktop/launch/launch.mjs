// Lanzador (lo ejecuta el acceso directo, sin consola):
//   1. Si hay una versión nueva en GitHub, la descarga y la instala.
//   2. Abre la ventana de la app con la carpeta de datos elegida al instalar.
// Si no hay conexión o algo falla al actualizar, abre la versión que ya está instalada.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildApp,
  CONFIG_FILE,
  depsHash,
  downloadCommit,
  electronPath,
  latestCommit,
  log,
  mirror,
  npmInstall,
  readJson,
  showUpdatingNotice,
  writeJson,
} from './common.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const cfgFile = path.join(root, CONFIG_FILE);
const cfg = readJson(cfgFile);
if (!cfg?.dataDir) {
  console.error('Watchlist no está instalada en este PC: ejecuta instalar.bat.');
  process.exit(1);
}

async function updateIfNeeded() {
  if (!cfg.repo || process.env.WATCHLIST_NO_UPDATE) return;
  let latest;
  try {
    latest = await latestCommit(cfg);
  } catch (err) {
    log(`Sin comprobar actualizaciones (${err.message}). Se abre la versión instalada.`);
    return;
  }
  if (!latest || latest.sha === cfg.installedSha) {
    log(`Versión al día (${(cfg.installedSha ?? '').slice(0, 7)}).`);
    return;
  }

  log(`Nueva versión ${latest.sha.slice(0, 7)} (${latest.date}). Actualizando…`);
  const hideNotice = showUpdatingNotice();
  let pkg;
  try {
    pkg = await downloadCommit(cfg, latest.sha);
    const { copied, removed } = mirror(pkg.dir, root);
    log(`${copied} ficheros actualizados, ${removed} eliminados.`);
    const deps = depsHash(root);
    if (deps !== cfg.depsHash || !fs.existsSync(path.join(root, 'node_modules'))) {
      log('Las dependencias han cambiado: npm install…');
      npmInstall(root, { quiet: true });
    }
    buildApp(root, { quiet: true });
    Object.assign(cfg, { installedSha: latest.sha, installedDate: latest.date, depsHash: deps, builtAt: new Date().toISOString() });
    writeJson(cfgFile, cfg);
    log('Actualización completada.');
  } catch (err) {
    log(`La actualización falló: ${err.message}. Se abre la versión instalada.`);
  } finally {
    hideNotice();
    pkg?.cleanup();
  }
}

// Opciones: --oculta (arrancar solo en la bandeja) · --esperar (reinicio tras detectar una
// actualización: deja que la instancia anterior termine de cerrarse antes de tocar ficheros).
const args = process.argv.slice(2);
if (args.includes('--esperar')) await new Promise((r) => setTimeout(r, 4000));

await updateIfNeeded();

// Si por lo que sea falta la compilación (p. ej. una actualización a medias), se rehace.
if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html')) || !fs.existsSync(path.join(root, 'apps/desktop/dist/main.mjs'))) {
  log('Compilando la app…');
  buildApp(root, { quiet: true });
}

const electron = electronPath(root);
const version = cfg.installedSha ? `${cfg.installedSha.slice(0, 7)} · ${(cfg.installedDate ?? '').slice(0, 10)}` : 'instalación local';
log(`Abriendo Watchlist (${version}). Datos: ${cfg.dataDir}`);

const child = spawn(electron, [path.join(root, 'apps/desktop'), ...args.filter((a) => a === '--oculta')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WATCHLIST_DATA_DIR: cfg.dataDir,
    WATCHLIST_VERSION: version,
    // Para que la app busque actualizaciones en segundo plano y se reinicie a través de este lanzador.
    WATCHLIST_SHA: cfg.installedSha ?? '',
    WATCHLIST_REPO: cfg.repo ?? '',
    WATCHLIST_BRANCH: cfg.branch ?? 'main',
    WATCHLIST_NODE: process.execPath,
    WATCHLIST_LAUNCHER: import.meta.filename,
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
