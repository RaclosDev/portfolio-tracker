/**
 * Actualizaciones mientras la app está abierta o en la bandeja.
 *
 * Cómo se entera de que hay versión nueva:
 *  1. Aviso instantáneo: al hacer push a main, una GitHub Action publica un mensaje en un canal
 *     de ntfy.sh. La app mantiene abierta una conexión a ese canal y, al recibirlo, comprueba.
 *  2. Respaldo: al reconectar el canal, al despertar el PC y cada pocas horas.
 * En todos los casos la decisión la toma GitHub (API de commits, con petición condicional que no
 * gasta cupo si no hay cambios): el aviso solo dispara la comprobación, nunca instala nada por sí mismo.
 *
 * Quien instala es el lanzador (launch.mjs): aquí solo se reinicia la app a través de él.
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
  pushTopic: process.env.WATCHLIST_PUSH_TOPIC ?? null,
};

const UA = { 'User-Agent': 'watchlist-desktop-app' };

export const updatesEnabled = () => Boolean(env.repo && env.node && env.launcher);

let etag: string | null = null;
let latest: UpdateInfo | null = null;

/** Devuelve la versión nueva si la hay. Usa ETag: si GitHub responde 304 no consume cupo. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!updatesEnabled()) return null;
  const res = await fetch(`https://api.github.com/repos/${env.repo}/commits/${encodeURIComponent(env.branch)}`, {
    headers: { Accept: 'application/vnd.github+json', ...UA, ...(etag ? { 'If-None-Match': etag } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status !== 304) {
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    const data = (await res.json()) as { sha: string; commit?: { committer?: { date?: string } } };
    etag = res.headers.get('etag');
    latest = { sha: data.sha, date: data.commit?.committer?.date ?? null };
    verified = false;
  }
  if (!latest || latest.sha === env.sha) return null;
  // Solo se instalan versiones que han pasado la verificación de GitHub Actions (job «verificar»).
  if (!verified) verified = await passedVerification(latest.sha);
  return verified ? latest : null;
}

let verified = false;

async function passedVerification(sha: string) {
  try {
    const res = await fetch(`https://api.github.com/repos/${env.repo}/commits/${sha}/check-runs?check_name=verificar`, {
      headers: { Accept: 'application/vnd.github+json', ...UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { check_runs?: { status: string; conclusion: string | null }[] };
    return (data.check_runs ?? []).some((r) => r.status === 'completed' && r.conclusion === 'success');
  } catch {
    return false;
  }
}

/**
 * Escucha el canal de avisos de versión nueva (conexión abierta permanente, con reconexión
 * automática y vigilancia de conexiones "zombis"). Devuelve cómo dejar de escuchar.
 */
export function listenForReleases(onPing: (reason: string) => void, log: (msg: string, err?: unknown) => void) {
  if (!updatesEnabled() || !env.pushTopic) return () => {};
  let stopped = false;
  let ctrl: AbortController | null = null;
  let lastData = Date.now();
  // ntfy manda un "keepalive" cada ~45 s: si pasan 2 min sin nada, la conexión está muerta.
  const watchdog = setInterval(() => {
    if (ctrl && Date.now() - lastData > 120_000) ctrl.abort();
  }, 30_000);

  const connect = async () => {
    let delay = 5_000;
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await fetch(`https://ntfy.sh/${encodeURIComponent(env.pushTopic!)}/json`, {
          headers: UA,
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`ntfy respondió ${res.status}`);
        lastData = Date.now();
        delay = 5_000;
        log('Escuchando avisos de versión nueva');
        onPing('conexión'); // por si se publicó algo mientras no había conexión
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          lastData = Date.now();
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
              if ((JSON.parse(line) as { event?: string }).event === 'message') onPing('aviso');
            } catch {
              /* línea no JSON: se ignora */
            }
          }
        }
      } catch (err) {
        if (stopped) break;
        log('Canal de avisos desconectado, se reintenta', err);
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 5 * 60_000);
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearInterval(watchdog);
    ctrl?.abort();
  };
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
