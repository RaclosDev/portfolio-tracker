// Instalador: copia el programa a este PC, instala dependencias, elige la carpeta de datos
// y crea el acceso directo. Se ejecuta con instalar.bat / instalar.sh desde la carpeta del proyecto.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {
  buildApp,
  CONFIG_FILE,
  depsHash,
  electronPath,
  localAppRoot,
  watchlistHome,
  mirror,
  npmInstall,
  readJson,
  writeJson,
} from './common.mjs';

const src = path.resolve(import.meta.dirname, '../../..');
const dst = localAppRoot();
const cfgFile = path.join(dst, CONFIG_FILE);
const previous = readJson(cfgFile, {});
const update = readJson(path.join(src, 'watchlist.update.json'), {});
const seed = path.join(src, 'apps/server/seed/watchlist.seed.json');

const step = (n, text) => console.log(`\n ${n}/5  ${text}`);

/** Selector de carpeta nativo en Windows; pregunta por consola en macOS/Linux. */
async function chooseDataDir(suggested) {
  console.log(
    '\n   Elige la carpeta donde se guardarán los datos (tus listas y valores).' +
      '\n   Si vas a usar la app en varios PCs, elige en todos la MISMA carpeta compartida' +
      '\n   (OneDrive, Google Drive, Dropbox…). Si no, deja la que se propone.',
  );
  if (process.platform === 'win32') {
    fs.mkdirSync(suggested, { recursive: true });
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$d = New-Object Windows.Forms.FolderBrowserDialog;',
      '$d.Description = "Carpeta de datos de Watchlist (la misma carpeta compartida en todos tus PCs)";',
      '$d.ShowNewFolderButton = $true;',
      `$d.SelectedPath = '${suggested.replace(/'/g, "''")}';`,
      'if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }',
    ].join(' ');
    const res = spawnSync('powershell', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' });
    const chosen = res.stdout?.trim();
    return chosen || suggested;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`   Carpeta [${suggested}]: `)).trim();
  rl.close();
  return answer || suggested;
}

function createShortcut() {
  if (process.platform === 'win32') {
    const ps1 = path.join(dst, 'apps/desktop/launch/crear-accesos.ps1');
    const dest = process.env.WATCHLIST_SHORTCUT_DIR ? ['-Destinations', process.env.WATCHLIST_SHORTCUT_DIR] : [];
    const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...dest], {
      stdio: 'inherit',
    });
    if (res.status !== 0) throw new Error('No se pudo crear el acceso directo');
    return;
  }
  // Usa el mismo Node.js que ejecuta el instalador (el portátil que descarga instalar.sh).
  const nodeBin = process.execPath;
  const launch = `cd "${dst}" && PATH="${path.dirname(nodeBin)}:$PATH" "${nodeBin}" apps/desktop/launch/launch.mjs >/tmp/watchlist-launch.log 2>&1`;
  if (process.platform === 'darwin') {
    const file = path.join(os.homedir(), 'Desktop', 'Watchlist.command');
    fs.writeFileSync(file, `#!/bin/sh\n(${launch}) &\n`, { mode: 0o755 });
    console.log(`   Lanzador creado: ${file}`);
  } else {
    const dir = path.join(os.homedir(), '.local/share/applications');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'watchlist.desktop'),
      `[Desktop Entry]\nType=Application\nName=Watchlist\nExec=sh -c '${launch}'\nIcon=${dst}/apps/desktop/assets/icon.png\nTerminal=false\nCategories=Office;Finance;\n`,
    );
    console.log('   Entrada creada en el menú de aplicaciones.');
  }
}

try {
  console.log('\n  Instalando Watchlist');
  console.log(`  Programa en: ${dst}`);

  step(1, 'Carpeta de datos');
  let dataDir = previous.dataDir;
  if (dataDir) {
    console.log(`   Se mantiene la carpeta de datos actual: ${dataDir}`);
    console.log('   (para cambiarla, borra el fichero ' + cfgFile + ' y vuelve a instalar)');
  } else {
    dataDir = process.env.WATCHLIST_INSTALL_DATA_DIR || (await chooseDataDir(path.join(watchlistHome(), 'datos')));
  }
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`   Datos en: ${dataDir}`);

  // Datos iniciales (solo si la carpeta aún no tiene base de datos): los importa la app al abrirse.
  if (!fs.existsSync(path.join(dataDir, 'watchlist.db')) && fs.existsSync(seed)) {
    fs.copyFileSync(seed, path.join(dataDir, 'importar.json'));
    console.log('   Se cargarán los valores iniciales la primera vez que abras la app.');
  }

  step(2, 'Copiando el programa');
  const { copied, removed } = mirror(src, dst);
  console.log(`   ${copied} ficheros copiados, ${removed} eliminados.`);

  step(3, 'Instalando dependencias (la primera vez tarda unos minutos)');
  npmInstall(dst);
  electronPath(dst); // descarga el motor de la ventana durante la instalación, no al abrir

  step(4, 'Preparando la app');
  buildApp(dst);

  writeJson(cfgFile, {
    dataDir,
    repo: update.repo ?? null,
    branch: update.branch ?? 'main',
    installedSha: previous.installedSha ?? null,
    installedDate: previous.installedDate ?? null,
    depsHash: depsHash(dst),
    builtAt: new Date().toISOString(),
  });

  step(5, 'Creando el acceso directo');
  createShortcut();

  // En Windows el mensaje final lo da instalar.ps1, tras registrar la app.
  if (process.platform !== 'win32') console.log('\n  Listo. Abre "Watchlist" desde el escritorio o el menú Inicio.');
  if (update.repo) console.log(`  La app se actualizará sola desde github.com/${update.repo} al abrirse.\n`);
} catch (err) {
  console.error(`\n  ERROR: ${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
}
