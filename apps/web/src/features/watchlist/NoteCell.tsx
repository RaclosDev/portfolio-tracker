import { useId, useRef, type SyntheticEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';

/*
 * Nota de un valor en la tabla. En el escritorio, un icono: la nota se ve al pasar el ratón o al
 * pulsarlo (popover nativo: Escape y clic fuera la cierran). En la tarjeta del móvil se ve el texto
 * entero, que allí sí cabe.
 */
export function NoteCell({ note }: { note: string }) {
  const id = useId();
  const pop = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const pinned = useRef(false);

  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    const p = pop.current;
    if (!b || !p) return;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const left = Math.min(Math.max(8, b.right - w), window.innerWidth - w - 8);
    const below = b.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 6) : below;
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  };
  const show = () => {
    window.clearTimeout(hideTimer.current);
    const p = pop.current;
    if (p && !p.matches(':popover-open')) p.showPopover();
  };
  const hideSoon = () => {
    if (pinned.current) return;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => pop.current?.hidePopover(), 150);
  };
  const stop = (e: SyntheticEvent) => e.stopPropagation(); // que no despliegue ni edite la fila

  return (
    <>
      <span className="notes notes--inline">{note}</span>
      <button
        ref={btn}
        type="button"
        className="note-btn"
        aria-label="Ver nota"
        aria-describedby={id}
        popoverTarget={id}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onClick={(e) => {
          stop(e);
          // El popover lo abre o cierra el navegador; si ya estaba abierto por el ratón, el clic lo fija.
          if (pop.current?.matches(':popover-open') && !pinned.current) {
            e.preventDefault();
            pinned.current = true;
          }
        }}
        onDoubleClick={stop}
      >
        <Icon name="note" />
      </button>
      <div
        ref={pop}
        id={id}
        role="tooltip"
        popover="auto"
        className="note-pop"
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onClick={stop}
        onDoubleClick={stop}
        onToggle={(e) => {
          if ((e as unknown as ToggleEvent).newState === 'open') place();
          else pinned.current = false;
        }}
      >
        {note}
      </div>
    </>
  );
}
