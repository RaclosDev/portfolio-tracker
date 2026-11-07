import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { desktop } from '../../desktop.ts';
import { goToRow } from '../watchlist/Highlights.tsx';

const KIND_LABEL = {
  reached: 'En zona',
  near: 'Cerca',
  orderTouched: 'Orden',
  orderExpiring: 'Caducidad',
} as const;

const PILL = { reached: 'pill--reached', near: 'pill--near', orderTouched: 'badge--order', orderExpiring: 'badge--danger' } as const;

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `hoy, ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Historial de los avisos enviados (los guarda la app de escritorio en la carpeta de datos). */
export function AlertsDialog({ itemIds, onClose }: { itemIds: Map<string, number>; onClose: () => void }) {
  const q = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 30_000 });

  return (
    <Dialog title="Historial de avisos" onClose={onClose} wide>
      {q.isPending && <p className="muted">Cargando…</p>}
      {q.isError && <p className="error-box">No se pudo leer el historial.</p>}
      {q.data && q.data.length === 0 && (
        <p className="muted">
          Todavía no hay avisos.{' '}
          {desktop
            ? 'Aparecerán aquí cuando un valor entre en zona de compra, se acerque a un nivel o toque una orden.'
            : 'Los avisos los envía la app de escritorio (acceso directo «Watchlist»).'}
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
