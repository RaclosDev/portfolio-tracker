import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { goToRow } from '../watchlist/Highlights.tsx';

const KIND_LABEL = {
  reached: 'En zona',
  near: 'Muy cerca',
  orderTouched: 'Orden',
  orderExpiring: 'Caducidad',
  sellReached: 'Venta',
  sellNear: 'Cerca venta',
} as const;

const PILL = {
  reached: 'pill--reached',
  near: 'pill--veryNear',
  orderTouched: 'badge--order',
  orderExpiring: 'badge--danger',
  sellReached: 'pill--reached',
  sellNear: 'pill--near',
} as const;

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `hoy, ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Historial de los avisos que ha detectado el servidor. */
export function AlertsDialog({ itemIds, onClose }: { itemIds: Map<string, number>; onClose: () => void }) {
  const q = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 30_000 });

  return (
    <Dialog title="Historial de avisos" onClose={onClose} wide>
      {q.isPending && <p className="muted">Cargando…</p>}
      {q.isError && <p className="error-box">No se pudo leer el historial.</p>}
      {q.data && q.data.length === 0 && (
        <p className="muted">
          Todavía no hay avisos.{' '}
Aparecerán aquí cuando un valor entre en zona de compra, se acerque a un nivel, toque una orden o llegue a
          su objetivo de venta. Para recibirlos también como notificación, actívalas en Ajustes → Notificaciones.
        </p>
      )}
      {q.data && q.data.length > 0 && (
        <ul className="alert-list">
          {q.data.map((a, i) => {
            const id = itemIds.get(a.symbol);
            return (
              <li key={`${a.at}-${i}`}>
                <span className={`pill ${PILL[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                <div className="alert-list__text">
                  {id ? (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        onClose();
                        setTimeout(() => goToRow(id), 50);
                      }}
                    >
                      {a.title}
                    </button>
                  ) : (
                    <strong>{a.title}</strong>
                  )}
                  <span className="muted small">{a.body}</span>
                </div>
                <span className="muted small alert-list__when" title={`Mostrado en ${a.host}`}>
                  {when(a.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
