import { useId, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { Icon, type IconName } from './Icon.tsx';

/**
 * Icono con un popover que sale al pasar el ratón o al pulsarlo (y se fija con el clic). `inline` es
 * lo que se ve en su lugar en la tarjeta del móvil de la tabla, donde no hay ratón.
 */
export function HoverInfo({ icon, trigger, label, inline, className, popClassName = '', children }: {
  icon?: IconName;
  /** Lo que se pulsa en lugar del icono (p. ej. el propio número del PER). */
  trigger?: ReactNode;
  label: string;
  inline?: ReactNode;
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
      {inline != null && <span className="notes notes--inline">{inline}</span>}
      <button
        ref={btn}
        type="button"
        className={className}
        aria-label={label}
        aria-describedby={id}
        popoverTarget={id}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        // Al pulsar dentro del popover el botón pierde el foco: no se cierra si el ratón está encima.
        onBlur={() => { if (!pop.current?.matches(':hover')) hideSoon(); }}
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
        {trigger ?? (icon && <Icon name={icon} />)}
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

/**
 * Icono (i) junto a un título con la explicación larga dentro: se ve al pasar el ratón, con el foco
 * o al pulsarlo (también en el móvil), y se cierra con Escape o con un clic fuera.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <HoverInfo icon="info" label={label} className="note-btn info-tip" popClassName="info-tip__pop">
      {children}
    </HoverInfo>
  );
}
