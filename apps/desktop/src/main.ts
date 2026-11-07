/**
 * Proceso principal de la app de escritorio.
 * Arranca la API dentro de la propia app (invisible para el usuario) y abre una ventana con la web.
 * Al cerrar la ventana se detiene todo.
 *
 * Carpeta de datos: la variable WATCHLIST_DATA_DIR (la pone el lanzador con la carpeta elegida
 * al instalar, que puede ser una carpeta compartida entre PCs) o, en desarrollo, <proyecto>/datos.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { localToday } from '@watchlist/shared';
import { startServer, type RunningServer } from '../../server/src/server.ts';
import { acquireLock, dailyBackup, findConflictCopies, migrateLegacyData, otherPcLock } from './data-folder.ts';

// dist/main.mjs → raíz del proyecto
const ROOT = path.resolve(import.meta.dirname, '../../..');
const WEB_DIST = path.join(ROOT, 'apps/web/dist');
const SEED_FILE = path.join(ROOT, 'apps/server/seed/watchlist.seed.json');
const ICON = path.join(ROOT, 'apps/desktop/assets/icon.png');
const DATA_DIR = path.resolve(process.env.WATCHLIST_DATA_DIR || path.join(ROOT, 'datos'));
/** Puerto fijo: así las preferencias del navegador interno (tour visto, lista abierta) se conservan. */
const PREFERRED_PORT = 5175;

app.setName('Watchlist');

let win: BrowserWindow | null = null;
let server: RunningServer | null = null;
let releaseLock: (() => void) | null = null;

function portIsFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

const timeEs = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

/** Comprobaciones de la carpeta de datos. Devuelve false si el usuario decide no abrir. */
function prepareDataFolder(): boolean {
  const parent = path.dirname(DATA_DIR);
  if (!fs.existsSync(parent)) {
    dialog.showErrorBox(
      'No se encuentra la carpeta de datos',
      `La carpeta donde se guardan los datos no está disponible:\n\n${DATA_DIR}\n\n` +
        'Si es una carpeta compartida (OneDrive, Google Drive…), comprueba que esté sincronizada en este PC ' +
        'y vuelve a abrir la app. Para elegir otra carpeta, ejecuta de nuevo instalar.bat.',
    );
    return false;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const other = otherPcLock(DATA_DIR);
  if (other) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Watchlist ya está abierta en otro PC',
      message: `Watchlist está abierta en ${other.host} desde el ${timeEs(other.since)}.`,
      detail:
        'Si la usas en los dos PCs a la vez, los cambios de uno pueden pisar los del otro. ' +
        'Lo recomendable es cerrarla allí, esperar a que se sincronice la carpeta y abrirla aquí.',
      buttons: ['Salir', 'Abrir de todas formas'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 0) return false;
  }

  migrateLegacyData(DATA_DIR, path.join(app.getPath('userData'), 'data'));
  try {
    dailyBackup(DATA_DIR, localToday());
  } catch (err) {
    console.warn('No se pudo hacer la copia diaria:', err);
  }
  releaseLock = acquireLock(DATA_DIR);
  return true;
}

function warnConflictCopies() {
  const copies = findConflictCopies(DATA_DIR);
  if (!copies.length || !win) return;
  void dialog.showMessageBox(win, {
    type: 'info',
    title: 'Copias en conflicto',
    message: 'La sincronización ha creado copias en conflicto de la base de datos.',
    detail:
      `En ${DATA_DIR} hay:\n• ${copies.join('\n• ')}\n\n` +
      `Tus datos actuales están en watchlist.db. Esas copias suelen aparecer al usar la app en dos PCs a la vez. ` +
      'Si no echas nada en falta, puedes borrarlas. Las copias diarias están en la subcarpeta "copias".',
    buttons: ['Entendido', 'Abrir la carpeta'],
    noLink: true,
  }).then(({ response }) => {
    if (response === 1) void shell.openPath(DATA_DIR);
  });
}

async function createWindow() {
  if (!prepareDataFolder()) {
    app.quit();
    return;
  }

  // Datos iniciales que deja el instalador (solo se usan si la base de datos está vacía).
  const importFile = path.join(DATA_DIR, 'importar.json');
  const initialData = fs.existsSync(importFile) ? importFile : SEED_FILE;

  server = await startServer({
    host: '127.0.0.1',
    port: (await portIsFree(PREFERRED_PORT)) ? PREFERRED_PORT : 0,
    dataDir: DATA_DIR,
    journalMode: 'DELETE', // un único fichero: seguro para carpetas sincronizadas
    web: { kind: 'dir', root: WEB_DIST },
    seedFile: initialData,
    quiet: true,
  });
  if (initialData !== SEED_FILE && fs.existsSync(initialData)) fs.renameSync(initialData, `${initialData}.importado`);

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: 'Watchlist',
    icon: ICON,
    backgroundColor: '#0f1216',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => {
    win?.show();
    warnConflictCopies();
  });

  // Enlaces externos → navegador del sistema; la ventana solo muestra la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (server && !url.startsWith(server.url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Atajos: F5 / Ctrl+R recargar, Ctrl+± zoom, F12 herramientas de desarrollo.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const wc = win!.webContents;
    if (key === 'f5' || (input.control && key === 'r')) wc.reload();
    else if (key === 'f12') wc.toggleDevTools();
    else if (input.control && (key === '+' || key === '=')) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    else if (input.control && key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    else if (input.control && key === '0') wc.setZoomLevel(0);
    else return;
    e.preventDefault();
  });

  win.on('closed', () => (win = null));
  await win.loadURL(server.url);
}

// Una sola instancia: si ya está abierta, otro clic en el acceso directo la trae al frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  Menu.setApplicationMenu(null);

  app
    .whenReady()
    .then(createWindow)
    .catch((err: unknown) => {
      dialog.showErrorBox('No se pudo abrir Watchlist', err instanceof Error ? (err.stack ?? err.message) : String(err));
      app.quit();
    });

  app.on('window-all-closed', async () => {
    await server?.close();
    releaseLock?.();
    app.quit();
  });
}
