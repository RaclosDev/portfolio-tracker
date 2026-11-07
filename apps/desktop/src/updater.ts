/**
 * Actualizaciones mientras la app está abierta o en la bandeja.
 * El lanzador (launch.mjs) es quien instala: aquí solo se detecta que hay versión nueva
 * en GitHub y se reinicia la app a través del lanzador para aplicarla.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface UpdateInfo {
  sha: string;
  date: string | null;
}

/** Datos que pasa el lanzador al arrancar Electron. Sin ellos (modo desarrollo) no hay actualizaciones. */
const env = {
  sha: process.env.WATCHLIST_SHA ?? null,
  repo: process.env.WATCHLIST_REPO ?? null,
  branch: process.env.WATCHLIST_BRANCH ?? 'main',
  node: process.env.WATCHLIST_NODE ?? null,
  launcher: process.env.WATCHLIST_LAUNCHER ?? null,
};

export const updatesEnabled = () => Boolean(env.repo && env.node && env.launcher);

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!updatesEnabled()) return null;
  const res = await fetch(`https://api.github.com/repos/${env.repo}/commits/${encodeURIComponent(env.branch)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'watchlist-desktop-app' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const data = (await res.json()) as { sha: string; commit?: { committer?: { date?: string } } };
  return data.sha !== env.sha ? { sha: data.sha, date: data.commit?.committer?.date ?? null } : null;
}

/**
 * Lanza de nuevo el lanzador (que descarga e instala la versión nueva y abre la app)
 * y deja que esta instancia se cierre. `hidden`: volver a arrancar solo en la bandeja.
 */
export function relaunchThroughLauncher(hidden: boolean) {
  if (!updatesEnabled()) return false;
  try {
    // Registro propio: el del arranque (watchlist-launch.log) lo tiene abierto el lanzador actual.
    const out = fs.openSync(path.join(os.tmpdir(), 'watchlist-actualizacion.log'), 'a');
    const args = [env.launcher!, '--esperar', ...(hidden ? ['--oculta'] : [])];
    spawn(env.node!, args, {
      cwd: path.resolve(path.dirname(env.launcher!), '../../..'),
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
      env: process.env,
    }).unref();
    return true;
  } catch (err) {
    console.log('No se pudo reiniciar para actualizar:', err);
    return false;
  }
}
