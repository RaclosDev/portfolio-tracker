import { useId, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';

/**
 * Lógica común de los menús desplegables de la app (selector de lista, filtros): popover nativo
 * colocado bajo el botón, flechas/Inicio/Fin entre opciones y foco en la elegida al abrir.
 * Escape y clic fuera los cierra el propio popover.
 */
export function useMenuPopover(minWidth = 220) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** Elemento al que se alinea el menú, si no es el botón (la pestaña partida de las listas). */
  const anchor = useRef<HTMLSpanElement>(null);

  const place = () => {
    const b = (anchor.current ?? btn.current)?.getBoundingClientRect();
    const p = pop.current;
    if (!b || !p) return;
    p.style.minWidth = `${Math.max(minWidth, b.width)}px`;
    const left = Math.min(Math.max(8, b.left), window.innerWidth - p.offsetWidth - 8);
    p.style.left = `${left}px`;
    const below = window.innerHeight - b.bottom - 16;
    // Sin sitio debajo (botón al pie de la pantalla), se abre hacia arriba.
    if (below < 160 && b.top > below) {
      p.style.maxHeight = `${b.top - 16}px`;
      p.style.top = `${Math.max(8, b.top - 6 - Math.min(p.scrollHeight, b.top - 16))}px`;
    } else {
      p.style.maxHeight = `${Math.max(160, below)}px`;
      p.style.top = `${b.bottom + 6}px`;
    }
  };
  const items = () => [...(pop.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
  const pick = (fn: () => void) => {
    pop.current?.hidePopover();
    fn();
    btn.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (to == null || !all.length) return;
    e.preventDefault();
    all[(to + all.length) % all.length]?.focus();
  };
  const onToggle = (e: SyntheticEvent) => {
    const open = (e.nativeEvent as ToggleEvent).newState === 'open';
    btn.current?.setAttribute('aria-expanded', String(open));
    if (!open) return;
    place();
    (items().find((el) => el.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
  };

  return { id, btn, pop, anchor, pick, menuProps: { ref: pop, id, popover: 'auto' as const, role: 'menu', onKeyDown, onToggle } };
}
