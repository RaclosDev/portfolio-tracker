import { useEffect, useRef, type ReactNode } from 'react';
import { confirmAction } from './feedback.tsx';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  /** Hay cambios sin guardar: pulsar fuera no cierra, y Escape o ✕ piden confirmación antes de descartarlos. */
  dirty?: boolean;
}

/** Modal accesible basado en <dialog> nativo (foco, Escape y fondo gestionados por el navegador). */
export function Dialog({ title, onClose, children, footer, wide, className, dirty }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  const requestClose = async () => {
    if (
      dirty &&
      !(await confirmAction({
        title: '¿Descartar los cambios?',
        message: 'Has hecho cambios que todavía no se han guardado.',
        confirmLabel: 'Descartar',
        danger: true,
      }))
    )
      return;
    onClose();
  };

  useEffect(() => {
    const el = ref.current!;
    if (!el.open) el.showModal();
    // showModal() enfoca el primer control (el botón cerrar); preferimos el campo marcado.
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => el.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog--wide' : ''}${className ? ` ${className}` : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        void requestClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current && !dirty) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <header className="dialog__header">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="icon-btn" onClick={() => void requestClose()} aria-label="Cerrar">
          ✕
        </button>
      </header>
      <div className="dialog__body">{children}</div>
      {footer && <footer className="dialog__footer">{footer}</footer>}
    </dialog>
  );
}
