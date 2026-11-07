// Lanzador (lo ejecuta el acceso directo, sin consola):
//   1. Si hay una versión nueva en GitHub, la descarga y la instala.
//   2. Abre la ventana de la app con la carpeta de datos elegida al instalar.
// Si no hay conexión o algo falla al actualizar, abre la versión que ya está instalada.
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  CONFIG_FILE,
  downloadRelease,
  electronPath,
  hasBuild,
  isBuildTree,
  latestCommit,
  log,
  mirror,
  passedVerification,
  prepareTree,
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

async function updateIfNeeded({ force = false } = {}) {
  if (!cfg.repo || process.env.WATCHLIST_NO_UPDATE) return;
  let latest;
  try {
    latest = await latestCommit(cfg);
  } catch (err) {
    log(`Sin comprobar actualizaciones (${err.message}). Se abre la versión instalada.`);
    return;
  }
  if (!latest || (!force && latest.sha === cfg.installedSha)) {
    log(`Versión al día (${(cfg.installedSha ?? '').slice(0, 7)}).`);
    return;
  }
  if (!(await passedVerification(cfg, latest.sha).catch(() => false))) {
    log(`Hay una versión nueva (${latest.sha.slice(0, 7)}) pero aún no ha pasado la verificación: se espera.`);
    return;
  }

  log(`Nueva versión ${latest.sha.slice(0, 7)} (${latest.date}). Actualizando…`);
  const hideNotice = showUpdatingNotice();
  let pkg;
  try {
    // Normalmente llega ya compilada (la publica la CI); si no, el código fuente y se compila aquí.
    pkg = await downloadRelease(cfg, latest.sha);
    const { copied, removed } = mirror(pkg.dir, root, { withBuild: pkg.withBuild });
    log(`${pkg.withBuild ? 'Versión compilada' : 'Código fuente'}: ${copied} ficheros actualizados, ${removed} eliminados.`);
    const deps = prepareTree(root, { quiet: true, previousHash: cfg.depsHash });
    Object.assign(cfg, {
      installedSha: latest.sha,
      installedDate: latest.date,
      depsHash: deps,
      builtAt: new Date().toISOString(),
      mode: pkg.withBuild ? 'compilada' : 'codigo',
    });
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

// Si por lo que sea falta algo (p. ej. una actualización a medias), se repara: con la versión
// compilada se vuelve a descargar; con el código fuente, se compila.
if (!hasBuild(root)) {
  if (isBuildTree(root)) {
    log('Faltan ficheros de la app: se vuelve a descargar.');
    await updateIfNeeded({ force: true });
  } else {
    log('Compilando la app…');
    prepareTree(root, { quiet: true, previousHash: cfg.depsHash });
  }
}

const electron = electronPath(root);
// Configuración de actualizaciones del código instalado (viene con cada versión).
const update = readJson(path.join(root, 'watchlist.update.json'), {});
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
    WATCHLIST_REPO: update.repo ?? cfg.repo ?? '',
    WATCHLIST_BRANCH: update.branch ?? cfg.branch ?? 'main',
    WATCHLIST_PUSH_TOPIC: update.pushTopic ?? '',
    WATCHLIST_NODE: process.execPath,
    WATCHLIST_LAUNCHER: import.meta.filename,
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
