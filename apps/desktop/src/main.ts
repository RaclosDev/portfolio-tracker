/**
 * Proceso principal de la app de escritorio.
 *
 *  - Ventana: arranca la API dentro de la app y muestra la web. Mientras está abierta, la
 *    carpeta de datos queda marcada "en uso" por este PC.
 *  - Bandeja del sistema: al cerrar la ventana la app puede seguir en segundo plano vigilando
 *    precios (solo lectura, sin bloquear la carpeta) y avisando con notificaciones de Windows.
 *  - Actualizaciones: cada hora mira GitHub; si hay versión nueva se aplica al cerrar la ventana
 *    (o al momento si solo está en la bandeja).
 *
 * Carpeta de datos: WATCHLIST_DATA_DIR (la pone el lanzador con la elegida al instalar) o,
 * en desarrollo (npm run desktop), <proyecto>/datos.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, shell, Tray } from 'electron';
import { localToday, type Alert } from '@watchlist/shared';
import { startServer, type RunningServer } from '../../server/src/server.ts';
import { acquireLock, dailyBackup, findConflictCopies, migrateLegacyData, otherPcLock } from './data-folder.ts';
import { PrefsStore, type DesktopPrefs } from './prefs.ts';
import { checkForUpdate, listenForReleases, relaunchThroughLauncher, updatesEnabled, type UpdateInfo } from './updater.ts';
import { PriceWatcher } from './watcher.ts';

// dist/main.mjs → raíz del proyecto
const ROOT = path.resolve(import.meta.dirname, '../../..');
const WEB_DIST = path.join(ROOT, 'apps/web/dist');
const SEED_FILE = path.join(ROOT, 'apps/server/seed/watchlist.seed.json');
const ICON_PNG = path.join(ROOT, 'apps/desktop/assets/icon.png');
const ICON_ICO = path.join(ROOT, 'apps/desktop/assets/icon.ico');
const PRELOAD = path.join(ROOT, 'apps/desktop/src/preload.cjs');
const LAUNCHER_VBS = path.join(ROOT, 'apps/desktop/launch/watchlist.vbs');
const WSCRIPT = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe');

/** Instalada con instalar.bat (la arranca el lanzador) o en desarrollo desde el código. */
const INSTALLED = Boolean(process.env.WATCHLIST_DATA_DIR);
const DATA_DIR = path.resolve(process.env.WATCHLIST_DATA_DIR || path.join(ROOT, 'datos'));
const START_HIDDEN = process.argv.includes('--oculta');
const APP_ID = INSTALLED ? 'com.raclosdev.watchlist' : 'com.raclosdev.watchlist.dev';
/** Puerto fijo: así las preferencias del navegador interno (tour visto, lista abierta) se conservan. */
const PREFERRED_PORT = INSTALLED ? 5175 : 5176;
/** Respaldo por si el canal de avisos instantáneos no llega (red corporativa, caída de ntfy…). */
const UPDATE_FALLBACK_MS = 6 * 60 * 60_000;

// En desarrollo usa otro nombre: no choca con la app instalada (preferencias, instancia única).
app.setName(INSTALLED ? 'Watchlist' : 'Watchlist (desarrollo)');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

let win: BrowserWindow | null = null;
let server: RunningServer | null = null;
let releaseLock: (() => void) | null = null;
let tray: Tray | null = null;
let prefs: PrefsStore;
let watcher: PriceWatcher;
let checkTimer: NodeJS.Timeout | undefined;
let quitting = false;
let pendingUpdate: UpdateInfo | null = null;

const log = (msg: string, err?: unknown) =>
  console.log(`[${new Date().toLocaleTimeString('es-ES')}] ${msg}${err ? `: ${err instanceof Error ? err.message : err}` : ''}`);

function portIsFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

const timeEs = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------ */
/* Carpeta de datos y sesión (ventana abierta = API + carpeta en uso)  */
/* ------------------------------------------------------------------ */

/** Comprobaciones de la carpeta de datos. Devuelve false si no se puede o no se quiere abrir. */
function prepareDataFolder(): boolean {
  if (!fs.existsSync(path.dirname(DATA_DIR))) {
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
      buttons: ['No abrir', 'Abrir de todas formas'],
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
    log('No se pudo hacer la copia diaria', err);
  }
  releaseLock = acquireLock(DATA_DIR);
  return true;
}

async function startSession(): Promise<boolean> {
  if (server) return true;
  if (!prepareDataFolder()) return false;
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
  return true;
}

/** Cierra la API y libera la carpeta de datos (la vigilancia en segundo plano no la necesita). */
async function stopSession() {
  const s = server;
  server = null;
  await s?.close();
  releaseLock?.();
  releaseLock = null;
}

function warnConflictCopies() {
  const copies = findConflictCopies(DATA_DIR);
  if (!copies.length || !win) return;
  void dialog
    .showMessageBox(win, {
      type: 'info',
      title: 'Copias en conflicto',
      message: 'La sincronización ha creado copias en conflicto de la base de datos.',
      detail:
        `En ${DATA_DIR} hay:\n• ${copies.join('\n• ')}\n\n` +
        'Tus datos actuales están en watchlist.db. Esas copias suelen aparecer al usar la app en dos PCs a la vez. ' +
        'Si no echas nada en falta, puedes borrarlas. Las copias diarias están en la subcarpeta "copias".',
      buttons: ['Entendido', 'Abrir la carpeta'],
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 1) void shell.openPath(DATA_DIR);
    });
}

/* ------------------------------------------------------------------ */
/* Ventana                                                             */
/* ------------------------------------------------------------------ */

async function openWindow() {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  if (!(await startSession())) return;

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: 'Watchlist',
    icon: ICON_PNG,
    backgroundColor: '#0f1216',
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => {
    win?.show();
    warnConflictCopies();
    if (pendingUpdate) win?.webContents.send('update:available', pendingUpdate);
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
    if (input.type !== 'keyDown' || !win) return;
    const key = input.key.toLowerCase();
    const wc = win.webContents;
    if (key === 'f5' || (input.control && key === 'r')) wc.reload();
    else if (key === 'f12') wc.toggleDevTools();
    else if (input.control && (key === '+' || key === '=')) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    else if (input.control && key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    else if (input.control && key === '0') wc.setZoomLevel(0);
    else return;
    e.preventDefault();
  });

  win.on('closed', () => void onWindowClosed());
  await win.loadURL(server!.url);
}

async function onWindowClosed() {
  win = null;
  await stopSession();
  if (quitting) return app.quit();
  // Había una actualización esperando: se aplica ahora y se vuelve a la bandeja.
  if (pendingUpdate && relaunchThroughLauncher(true)) {
    quitting = true;
    return app.quit();
  }
  if (!prefs.get().runInBackground) return app.quit();
  const p = prefs.get();
  if (!p.trayHintShown) {
    notify(
      'Watchlist sigue en segundo plano',
      'Vigila tus precios desde la bandeja del sistema (junto al reloj). Para cerrarla del todo: clic derecho en el icono → Salir.',
    );
    prefs.set({ trayHintShown: true });
  }
}

function quitApp() {
  quitting = true;
  if (win) win.close();
  else void stopSession().then(() => app.quit());
}

/* ------------------------------------------------------------------ */
/* Bandeja, notificaciones y vigilancia                                */
/* ------------------------------------------------------------------ */

function notify(title: string, body: string) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON_PNG });
  n.on('click', () => void openWindow());
  n.on('show', () => log(`Notificación mostrada: ${title}`));
  n.on('failed', (_e, error) => log(`Notificación fallida: ${title}`, error));
  n.show();
}

function showAlerts(alerts: Alert[]) {
  if (alerts.length > 4) {
    notify(`Watchlist: ${alerts.length} avisos`, `${alerts.slice(0, 4).map((a) => a.title).join('\n')}\n…`);
  } else {
    for (const a of alerts) notify(a.title, a.body);
  }
}

/** Frecuencia de Ajustes → General (la misma que con la ventana abierta). */
let refreshSeconds = 60;
let lastCheck: Date | null = null;

async function runCheck(manual = false): Promise<number> {
  const p = prefs.get();
  const day = new Date().getDay();
  if (!manual && (!p.notifications || (p.skipWeekends && (day === 0 || day === 6)))) return 0;
  try {
    const res = await watcher.check({ reached: p.notifyReached, near: p.notifyNear, orders: p.notifyOrders });
    if (res.refreshSeconds) refreshSeconds = res.refreshSeconds;
    lastCheck = new Date();
    updateTrayTooltip();
    if (res.alerts.length) log(`${res.alerts.length} aviso(s): ${res.alerts.map((a) => a.title).join(' | ')}`);
    showAlerts(res.alerts);
    return res.alerts.length;
  } catch (err) {
    log('No se pudieron comprobar los precios', err);
    return 0;
  }
}

/** Bucle de vigilancia: tras cada comprobación programa la siguiente con la frecuencia vigente. */
function scheduleChecks(delayMs = refreshSeconds * 1000) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    await runCheck();
    scheduleChecks();
  }, delayMs);
}

function updateTrayTooltip() {
  if (!tray) return;
  const when = lastCheck ? ` · comprobado a las ${lastCheck.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : '';
  tray.setToolTip(pendingUpdate ? 'Watchlist · hay una actualización' : `Watchlist · vigilando precios${when}`);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const p = prefs.get();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Watchlist', click: () => void openWindow() },
      { label: 'Comprobar precios ahora', click: () => void runCheck(true) },
      { type: 'separator' },
      {
        label: 'Notificaciones',
        type: 'checkbox',
        checked: p.notifications,
        click: (item) => {
          prefs.set({ notifications: item.checked });
          scheduleChecks(5_000);
        },
      },
      { type: 'separator' },
      ...(pendingUpdate ? [{ label: 'Instalar la actualización y reiniciar', click: () => applyUpdate() }] : []),
      { label: 'Buscar actualizaciones', click: () => void checkUpdates('manual') },
      { label: 'Salir', click: quitApp },
    ]),
  );
  updateTrayTooltip();
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PNG).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.on('click', () => void openWindow());
  rebuildTrayMenu();
}

/* ------------------------------------------------------------------ */
/* Actualizaciones                                                     */
/* ------------------------------------------------------------------ */

let checkingUpdates = false;

async function checkUpdates(reason: string) {
  if (checkingUpdates) return;
  checkingUpdates = true;
  try {
    const info = await checkForUpdate();
    if (!info) {
      if (reason === 'manual') notify('Watchlist está al día', 'No hay ninguna versión nueva.');
      return;
    }
    if (pendingUpdate?.sha === info.sha) return;
    pendingUpdate = info;
    log(`Versión nueva disponible (${reason}): ${info.sha.slice(0, 7)}`);
    rebuildTrayMenu();
    if (!win) {
      // Solo en la bandeja: se actualiza y reinicia sin molestar.
      if (relaunchThroughLauncher(true)) {
        quitting = true;
        await stopSession();
        app.quit();
      }
      return;
    }
    win.webContents.send('update:available', info);
    notify('Nueva versión de Watchlist', 'Se instalará al cerrar la ventana, o pulsa «Actualizar ahora» en la app.');
  } catch (err) {
    log('No se pudo comprobar si hay actualizaciones', err);
  } finally {
    checkingUpdates = false;
  }
}

function applyUpdate() {
  if (!relaunchThroughLauncher(!win)) return;
  quitting = true;
  if (win) win.close();
  else void stopSession().then(() => app.quit());
}

/* ------------------------------------------------------------------ */
/* Integración con Windows                                             */
/* ------------------------------------------------------------------ */

/** Acceso directo del menú Inicio con el AppUserModelID: Windows lo necesita para mostrar notificaciones. */
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !INSTALLED) return;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Watchlist.lnk');
  try {
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
      target: WSCRIPT,
      args: `"${LAUNCHER_VBS}"`,
      cwd: ROOT,
      icon: ICON_ICO,
      iconIndex: 0,
      appUserModelId: APP_ID,
      description: 'Watchlist de acciones y ETF',
    });
  } catch (err) {
    log('No se pudo actualizar el acceso directo del menú Inicio', err);
  }
}

function applyLoginItem() {
  if (process.platform !== 'win32' || !INSTALLED) return;
  app.setLoginItemSettings({
    openAtLogin: prefs.get().startWithWindows,
    path: WSCRIPT,
    args: [LAUNCHER_VBS, '--oculta'],
  });
}

function registerIpc() {
  const fromOurWindow = (e: Electron.IpcMainInvokeEvent) => Boolean(win && e.sender === win.webContents);
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromOurWindow(e)) throw new Error('No permitido');
      return fn(...args);
    });

  handle('prefs:get', () => prefs.get());
  handle('prefs:set', (patch: Partial<DesktopPrefs>) => {
    const p = prefs.set(patch ?? {});
    applyLoginItem();
    rebuildTrayMenu();
    scheduleChecks(2_000);
    return p;
  });
  handle('notify:test', () => notify('Notificación de prueba', 'Así se verán los avisos de Watchlist.'));
  handle('check:now', async () => ({ alerts: await runCheck(true) }));
  handle('data:dir', () => DATA_DIR);
  handle('update:status', () => pendingUpdate);
  handle('update:apply', () => applyUpdate());
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

// Una sola instancia: otro clic en el acceso directo abre (o trae al frente) la ventana.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!argv.includes('--oculta')) void openWindow();
  });

  Menu.setApplicationMenu(null);
  // La app no se cierra al cerrar la ventana: lo decide onWindowClosed().
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
    releaseLock?.();
  });

  app
    .whenReady()
    .then(async () => {
      prefs = new PrefsStore(app.getPath('userData'));
      watcher = new PriceWatcher(DATA_DIR, app.getPath('userData'), log);
      ensureStartMenuShortcut();
      applyLoginItem();
      registerIpc();
      createTray();
      scheduleChecks(15_000); // primera comprobación de precios a los 15 s, luego con la frecuencia de Ajustes
      if (updatesEnabled()) {
        // Aviso instantáneo (canal push) + respaldo: al despertar el PC y cada pocas horas.
        listenForReleases((reason) => void checkUpdates(reason), log);
        powerMonitor.on('resume', () => setTimeout(() => void checkUpdates('reanudar'), 15_000));
        setInterval(() => void checkUpdates('periódica'), UPDATE_FALLBACK_MS);
      }
      if (!START_HIDDEN) await openWindow();
    })
    .catch((err: unknown) => {
      dialog.showErrorBox('No se pudo abrir Watchlist', err instanceof Error ? (err.stack ?? err.message) : String(err));
      app.quit();
    });
}
