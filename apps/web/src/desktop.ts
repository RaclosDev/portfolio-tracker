/**
 * Puente con la app de escritorio (lo expone el preload de Electron).
 * En el navegador no existe: las opciones de escritorio se ocultan.
 */
export interface DesktopPrefs {
  /** Avisos de Windows activados. */
  notifications: boolean;
  notifyReached: boolean;
  notifyNear: boolean;
  notifyOrders: boolean;
  /** Cada cuántos minutos se comprueban los precios. */
  checkMinutes: number;
  /** No comprobar en fin de semana (mercados cerrados). */
  skipWeekends: boolean;
  /** Al cerrar la ventana, seguir vigilando desde la bandeja del sistema. */
  runInBackground: boolean;
  /** Arrancar con Windows (oculta en la bandeja). */
  startWithWindows: boolean;
}

export interface DesktopBridge {
  getPrefs(): Promise<DesktopPrefs>;
  setPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs>;
  testNotification(): Promise<void>;
  checkNow(): Promise<{ alerts: number }>;
  dataDir(): Promise<string>;
  updateStatus(): Promise<UpdateInfo | null>;
  applyUpdate(): Promise<void>;
  /** Devuelve la función para dejar de escuchar. */
  onUpdateAvailable(cb: (info: UpdateInfo) => void): () => void;
}

export interface UpdateInfo {
  sha: string;
  date: string | null;
}

export const desktop: DesktopBridge | undefined = (window as unknown as { watchlistDesktop?: DesktopBridge })
  .watchlistDesktop;
