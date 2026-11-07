/** Preferencias de ESTE PC (no se comparten por la carpeta de datos). */
import fs from 'node:fs';
import path from 'node:path';

export interface DesktopPrefs {
  notifications: boolean;
  notifyReached: boolean;
  notifyNear: boolean;
  notifyOrders: boolean;
  skipWeekends: boolean;
  runInBackground: boolean;
  startWithWindows: boolean;
  /** Ya se explicó que la app sigue en la bandeja al cerrar la ventana. */
  trayHintShown: boolean;
}

export const DEFAULT_PREFS: DesktopPrefs = {
  notifications: true,
  notifyReached: true,
  notifyNear: true,
  notifyOrders: true,
  skipWeekends: true,
  runInBackground: true,
  startWithWindows: false,
  trayHintShown: false,
};

export class PrefsStore {
  private file: string;
  private data: DesktopPrefs;

  constructor(dir: string) {
    this.file = path.join(dir, 'preferencias.json');
    let stored: Partial<DesktopPrefs> = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* primera vez */
    }
    this.data = { ...DEFAULT_PREFS, ...stored };
  }

  get(): DesktopPrefs {
    return { ...this.data };
  }

  set(patch: Partial<DesktopPrefs>): DesktopPrefs {
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === typeof DEFAULT_PREFS[k as keyof DesktopPrefs]),
    );
    this.data = { ...this.data, ...clean };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
}
