import type { NotificationSettings } from '@watchlist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api/client.ts';
import { currentSubscription, disablePush, enablePush, needsHomeScreen, pushSupported } from '../../lib/push.ts';

interface Props {
  value: NotificationSettings;
  onChange: (v: NotificationSettings) => void;
  refreshSeconds: number;
  onGoGeneral: () => void;
  Row: (p: { label: string; hint?: string; children: ReactNode }) => ReactNode;
  Switch: (p: { label: string; checked: boolean; onChange: (v: boolean) => void }) => ReactNode;
}

/**
 * Avisos: qué se avisa y cuándo (vale para todos los dispositivos, se guarda con «Guardar») y
 * en qué dispositivos se reciben (se activa al momento en este).
 */
export function NotificationsPanel({ value: n, onChange, refreshSeconds, onGoGeneral, Row, Switch }: Props) {
  const set = <K extends keyof NotificationSettings>(k: K, v: NotificationSettings[K]) => onChange({ ...n, [k]: v });
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: api.pushDevices });
  const key = useQuery({ queryKey: ['push-key'], queryFn: api.pushKey, staleTime: Infinity });
  const [here, setHere] = useState<string | null | undefined>(undefined); // endpoint de este dispositivo
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void currentSubscription().then((s) => setHere(s?.endpoint ?? null));
  }, []);

  const toggleHere = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (here) {
        await disablePush();
        setHere(null);
        setMsg('Este dispositivo ya no recibirá avisos.');
      } else {
        const err = await enablePush();
        if (err) setMsg(err);
        else {
          setHere((await currentSubscription())?.endpoint ?? null);
          setMsg('Listo: este dispositivo recibirá los avisos.');
        }
      }
      await qc.invalidateQueries({ queryKey: ['push-devices'] });
    } catch {
      setMsg('No se pudo cambiar. Vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Notificaciones</h3>
      <p className="intro">
        El servidor vigila los precios aunque no tengas la web abierta y envía los avisos a los dispositivos activados.
      </p>

      <h4 className="settings-sub">Dispositivos</h4>
      {key.data && !key.data.enabled ? (
        <p className="notice">El servidor todavía no tiene las claves de notificaciones (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY).</p>
      ) : !pushSupported() ? (
        <p className="muted small">Este navegador no admite notificaciones. Prueba con Chrome, Edge o Safari actualizados.</p>
      ) : (
        <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className={here ? 'btn' : 'btn btn--primary'} onClick={toggleHere} disabled={busy || here === undefined}>
            {busy ? 'Un momento…' : here ? 'Desactivar en este dispositivo' : 'Activar en este dispositivo'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!devices.data?.length}
            onClick={async () => {
              const r = await api.pushTest();
              setMsg(r.sent ? `Enviada a ${r.sent} dispositivo(s).` : 'No se pudo enviar a ningún dispositivo.');
            }}
          >
            Enviar prueba
          </button>
        </div>
      )}
      {needsHomeScreen() && !here && (
        <p className="muted small">
          En iPhone o iPad: Compartir → Añadir a pantalla de inicio, abre la web desde ese icono y activa aquí.
        </p>
      )}
      {msg && (
        <p className="small" role="status">
          {msg}
        </p>
      )}
      {devices.data && devices.data.length > 0 && (
        <ul className="list-admin">
          {devices.data.map((d) => (
            <li key={d.id}>
              <span>
                {d.label ?? d.endpointHost}
                <span className="muted small">
                  {' '}
                  · desde el {new Date(d.createdAt).toLocaleDateString('es-ES')}
                  {d.lastOkAt && `, último aviso el ${new Date(d.lastOkAt).toLocaleDateString('es-ES')}`}
                </span>
              </span>
              <span className="list-admin__actions">
                <button
                  type="button"
                  className="btn btn--small btn--danger-ghost"
                  onClick={async () => {
                    await api.removeDevice(d.id);
                    await qc.invalidateQueries({ queryKey: ['push-devices'] });
                    setHere((await currentSubscription())?.endpoint ?? null);
                  }}
                >
                  Quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h4 className="settings-sub">Qué avisar</h4>
      <Row label="Activar avisos">
        <Switch label="Activar avisos" checked={n.enabled} onChange={(v) => set('enabled', v)} />
      </Row>
      <Row label="En zona de compra" hint="El precio baja de alguno de tus niveles de compra.">
        <Switch label="Avisar en zona de compra" checked={n.reached} onChange={(v) => set('reached', v)} />
      </Row>
      <Row label="Cerca de un nivel" hint="Según el umbral de «cerca» de Estados y umbrales.">
        <Switch label="Avisar cerca" checked={n.near} onChange={(v) => set('near', v)} />
      </Row>
      <Row label="Órdenes" hint="El precio toca tu orden puesta o la orden está a punto de caducar.">
        <Switch label="Avisar de órdenes" checked={n.orders} onChange={(v) => set('orders', v)} />
      </Row>
      <Row label="Objetivo de venta" hint="Un valor de tu cartera llega a su objetivo de venta o se queda cerca.">
        <Switch label="Avisar del objetivo de venta" checked={n.sell} onChange={(v) => set('sell', v)} />
      </Row>

      <h4 className="settings-sub">Cuándo</h4>
      <Row label="Frecuencia" hint={`Los precios se comprueban cada ${Math.max(60, refreshSeconds)} segundos. Se cambia en General.`}>
        <button type="button" className="btn btn--small" onClick={onGoGeneral}>
          Ir a General
        </button>
      </Row>
      <Row label="No avisar en fin de semana" hint="Los mercados están cerrados.">
        <Switch label="Saltar fin de semana" checked={n.skipWeekends} onChange={(v) => set('skipWeekends', v)} />
      </Row>
      <Row label="Horas de silencio" hint="Hora de España. Lo que pase en ese tramo se avisa al terminar.">
        <span className="input-suffix">
          <Switch label="Horas de silencio" checked={n.quietHours} onChange={(v) => set('quietHours', v)} />
          <input type="time" aria-label="Silencio desde" value={n.quietFrom} disabled={!n.quietHours} onChange={(e) => set('quietFrom', e.target.value)} />
          a
          <input type="time" aria-label="Silencio hasta" value={n.quietTo} disabled={!n.quietHours} onChange={(e) => set('quietTo', e.target.value)} />
        </span>
      </Row>
      <Row label="Resumen diario" hint="Un aviso con lo que está en zona, cerca, las órdenes por caducar y los resultados del día.">
        <span className="input-suffix">
          <Switch label="Resumen diario" checked={n.dailySummary} onChange={(v) => set('dailySummary', v)} />
          <input type="time" aria-label="Hora del resumen" value={n.dailySummaryAt} disabled={!n.dailySummary} onChange={(e) => set('dailySummaryAt', e.target.value)} />
        </span>
      </Row>
      <div className="row-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const r = await api.checkAlerts();
            setMsg(r.alerts ? `${r.alerts} aviso(s) nuevo(s).` : 'Comprobado: nada nuevo que avisar.');
          }}
        >
          Comprobar ahora
        </button>
      </div>
    </>
  );
}
