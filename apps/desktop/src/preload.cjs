// Puente seguro entre la ventana (web) y la app de escritorio. Solo expone estas funciones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('watchlistDesktop', {
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  testNotification: () => ipcRenderer.invoke('notify:test'),
  checkNow: () => ipcRenderer.invoke('check:now'),
  dataDir: () => ipcRenderer.invoke('data:dir'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  onUpdateAvailable: (cb) => {
    const listener = (_e, info) => cb(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },
  openLogs: () => ipcRenderer.invoke('logs:open'),
  whatsNew: () => ipcRenderer.invoke('whatsnew:get'),
  markWhatsNewSeen: () => ipcRenderer.invoke('whatsnew:seen'),
});
