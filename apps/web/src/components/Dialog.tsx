import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Modal accesible basado en <dialog> nativo (foco, Escape y fondo gestionados por el navegador). */
export function Dialog({ title, onClose, children, footer, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

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
      className={`dialog${wide ? ' dialog--wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <header className="dialog__header">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </header>
      <div className="dialog__body">{children}</div>
      {footer && <footer className="dialog__footer">{footer}</footer>}
    </dialog>
  );
}
