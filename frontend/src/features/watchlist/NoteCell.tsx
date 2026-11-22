import { useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { Icon, type IconName } from '../../components/Icon.tsx';

/*
 * Nota de un valor en la tabla. En el escritorio, un icono: la nota se ve al pasar el ratón o al
 * pulsarlo (popover nativo: Escape y clic fuera la cierran). En la tarjeta del móvil se ve el texto
 * entero, que allí sí cabe.
 */
export function NoteCell({ note }: { note: string }) {
  return (
    <HoverInfo icon="note" label="Ver nota" inline={note} className="note-btn">
      {note}
    </HoverInfo>
  );
}

/**
 * Icono con un popover que sale al pasar el ratón o al pulsarlo (y se fija con el clic). `inline` es
 * lo que se ve en su lugar en la tarjeta del móvil, donde no hay ratón.
 */
export function HoverInfo({ icon, label, inline, className, popClassName = '', children }: {
  icon: IconName;
  label: string;
  inline: ReactNode;
  className: string;
  popClassName?: string;
  children: ReactNode;
}) {
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
      <span className="notes notes--inline">{inline}</span>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-label={label}
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
        <Icon name={icon} />
      </button>
      <div
        ref={pop}
        id={id}
        role="tooltip"
        popover="auto"
        className={`note-pop ${popClassName}`}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onClick={stop}
        onDoubleClick={stop}
        onToggle={(e) => {
          if ((e as unknown as ToggleEvent).newState === 'open') place();
          else pinned.current = false;
        }}
      >
        {children}
      </div>
    </>
  );
}
