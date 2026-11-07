/**
 * Notificaciones Web Push: el navegador de cada dispositivo (móvil, tablet, PC) se suscribe y el
 * servidor le envía los avisos aunque la web esté cerrada.
 */
import * as webpush from 'web-push';
import { iso, type Db } from '../../db/database.ts';

export interface PushPayload {
  title: string;
  body: string;
  /** Qué abrir al pulsar la notificación. */
  url?: string;
  /** Avisos con la misma etiqueta se sustituyen en vez de acumularse. */
  tag?: string;
}

export interface PushDevice {
  id: number;
  label: string | null;
  createdAt: string;
  lastOkAt: string | null;
  endpointHost: string;
}

export class PushService {
  readonly enabled: boolean;

  constructor(
    private db: Db,
    private keys: { publicKey: string | null; privateKey: string | null; subject: string },
    private log: (msg: string, err?: unknown) => void = () => {},
  ) {
    this.enabled = !!(keys.publicKey && keys.privateKey);
    if (this.enabled) webpush.setVapidDetails(keys.subject, keys.publicKey!, keys.privateKey!);
  }

  get publicKey() {
    return this.keys.publicKey;
  }

  async subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string | null) {
    await this.db.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
      [sub.endpoint, sub.keys.p256dh, sub.keys.auth, label],
    );
  }

  async unsubscribe(endpoint: string) {
    await this.db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  }

  async remove(id: number) {
    return (await this.db.query('DELETE FROM push_subscriptions WHERE id = $1 RETURNING id', [id])).length > 0;
  }

  async devices(): Promise<PushDevice[]> {
    const rows = await this.db.query<{ id: number; label: string | null; created_at: Date; last_ok_at: Date | null; endpoint: string }>(
      'SELECT id, label, created_at, last_ok_at, endpoint FROM push_subscriptions ORDER BY created_at',
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: iso(r.created_at),
      lastOkAt: r.last_ok_at ? iso(r.last_ok_at) : null,
      endpointHost: new URL(r.endpoint).host,
    }));
  }

  async count() {
    return (await this.db.one<{ n: number }>('SELECT COUNT(*)::int AS n FROM push_subscriptions'))!.n;
  }

  /** Envía a todos los dispositivos. Los que ya no existen (desinstalados, permiso retirado) se borran. */
  async sendAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
    if (!this.enabled) return { sent: 0, failed: 0 };
    const subs = await this.db.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions',
    );
    let sent = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 6 * 3600, urgency: 'high' },
          );
          sent++;
          await this.db.query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [s.id]);
        } catch (err) {
          failed++;
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await this.db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
          else this.log('No se pudo enviar una notificación', err);
        }
      }),
    );
    return { sent, failed };
  }
}
