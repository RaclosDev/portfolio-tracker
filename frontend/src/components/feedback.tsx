import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog } from './Dialog.tsx';

/*
 * Avisos breves (toasts) y confirmación con el estilo de la app, sin tener que pasar nada por props:
 *  - toast('Guardado') / toast('No se pudo guardar', { kind: 'error' }) / toast('Valor quitado', { action: { label: 'Deshacer', onClick } })
 *  - if (await confirmAction({ title, message, confirmLabel, danger: true })) …
 * <FeedbackHost /> se monta una sola vez en main.tsx y pinta ambos.
 */

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}
interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
  action?: ToastAction;
  duration: number;
}
interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let toasts: Toast[] = [];
let confirmReq: ConfirmRequest | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function toast(message: string, opts: { kind?: 'ok' | 'error'; action?: ToastAction; duration?: number } = {}) {
  const kind = opts.kind ?? 'ok';
  // Con acción (Deshacer) o error se deja más tiempo para leerlo y reaccionar.
  const duration = opts.duration ?? (opts.action ? 8000 : kind === 'error' ? 7000 : 3500);
  const t: Toast = { id: nextId++, message, kind, action: opts.action, duration };
  toasts = [...toasts.slice(-2), t]; // como mucho 3 a la vez
  emit();
  return t.id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Mensaje legible de un error de la API (o uno genérico). */
export const errorText = (e: unknown, fallback = 'No se pudo completar la acción.') =>
  e instanceof Error && e.message ? e.message : fallback;

/** Aviso de error estándar, para usar en onError o en un catch. */
export const toastError = (fallback: string) => (e: unknown) => toast(errorText(e, fallback), { kind: 'error' });

/** Sustituto de window.confirm() con el estilo de la app. */
export function confirmAction(req: Omit<ConfirmRequest, 'resolve'>) {
  return new Promise<boolean>((resolve) => {
    confirmReq?.resolve(false);
    confirmReq = { ...req, resolve };
    emit();
  });
}

const finishConfirm = (ok: boolean) => {
  confirmReq?.resolve(ok);
  confirmReq = null;
  emit();
};

export function FeedbackHost() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  const req = useSyncExternalStore(subscribe, () => confirmReq);
  const region = useRef<HTMLDivElement>(null);
  // Los diálogos abiertos con showModal() van en la "capa superior", por encima de cualquier z-index.
  // La zona de avisos es un popover manual que se vuelve a mostrar con cada aviso para quedar encima de ellos.
  useLayoutEffect(() => {
    const el = region.current;
    if (!el?.showPopover) return;
    if (el.matches(':popover-open')) el.hidePopover();
    if (list.length) el.showPopover();
  }, [list, req]);
  return (
    <>
      <div ref={region} className="toasts" popover="manual" aria-live="polite">
        {list.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </div>
      {req && (
        <Dialog
          title={req.title}
          onClose={() => finishConfirm(false)}
          className="dialog--confirm"
          footer={
            <>
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => finishConfirm(false)}>
                Cancelar
              </button>
              <button
                type="button"
                data-autofocus
                className={`btn ${req.danger ? 'btn--danger' : 'btn--primary'}`}
                onClick={() => finishConfirm(true)}
              >
                {req.confirmLabel ?? 'Aceptar'}
              </button>
            </>
          }
        >
          <p className="confirm__msg">{req.message}</p>
        </Dialog>
      )}
    </>
  );
}

function ToastView({ t }: { t: Toast }) {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissToast(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [paused, t.id, t.duration]);

  const run = async () => {
    if (!t.action || busy) return;
    setBusy(true);
    try {
      await t.action.onClick();
      dismissToast(t.id);
    } catch (e) {
      dismissToast(t.id);
      toast(errorText(e, 'No se pudo deshacer.'), { kind: 'error' });
    }
  };

  return (
    <div
      className={`toast toast--${t.kind}`}
      role={t.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__msg">{t.message}</span>
      {t.action && (
        <button type="button" className="toast__action" onClick={run} disabled={busy}>
          {t.action.label}
        </button>
      )}
      <button type="button" className="toast__close" onClick={() => dismissToast(t.id)} aria-label="Cerrar aviso">
        ✕
      </button>
    </div>
  );
}
