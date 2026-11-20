import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { pct, price } from '../../lib/format.ts';

/**
 * El carril se monta de nuevo con cada valor abierto (el detalle va bajo su fila). Guardamos su
 * desplazamiento y si el foco estaba en él para que, al saltar de valor, no pegue saltos ni pierda el foco.
 */
const railScroll = new Map<string, number>();
let refocus = false;

/** Lo que enseña el carril de cada valor: vale tanto para Vigilar como para Cartera. */
export interface RailItem {
  id: string | number;
  ticker: string;
  name: string | null;
  price: number | null;
  currency: string | null;
  changePct: number | null;
  /** Punto de aviso junto al ticker (nivel alcanzado o cerca). */
  signal?: 'reached' | 'near' | null;
}

interface Props {
  items: RailItem[];
  currentId: string | number;
  onPick: (id: string | number) => void;
  /** Nombre accesible; también separa el desplazamiento guardado de cada lista. */
  label?: string;
}

/** Columna con los demás valores de la lista, en el orden de la tabla: un clic abre ese valor aquí mismo. */
export function TickerRail({ items, currentId, onPick, label = 'Otros valores de la lista' }: Props) {
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = railScroll.get(label) ?? 0;
    const on = el.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if (!on) return;
    // Que el valor abierto quede a la vista dentro del carril, sin mover la página.
    const top = on.offsetTop - el.offsetTop;
    if (top < el.scrollTop) el.scrollTop = top - 8;
    else if (top + on.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + on.offsetHeight - el.clientHeight + 8;
    railScroll.set(label, el.scrollTop);
    if (refocus) {
      refocus = false;
      on.focus({ preventScroll: true });
    }
  }, []);

  const pick = (id: string | number) => {
    if (id === currentId) return;
    refocus = list.current?.contains(document.activeElement) ?? false;
    onPick(id);
  };

  // Flechas arriba y abajo recorren el carril; Inicio y Fin van a los extremos.
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <nav className="xp-rail" aria-label={label}>
      <ul ref={list} className="xp-rail__list" onScroll={(e) => railScroll.set(label, e.currentTarget.scrollTop)} onKeyDown={onKey}>
        {items.map((r) => {
          const on = r.id === currentId;
          return (
            <li key={r.id}>
              <button
                type="button"
                className={`xp-rail__item${on ? ' xp-rail__item--on' : ''}`}
                aria-current={on ? 'true' : undefined}
                title={r.name ?? r.ticker}
                onClick={() => pick(r.id)}
              >
                {on && <span className="xp-rail__mark" aria-hidden />}
                <span className="xp-rail__ticker">
                  {r.signal && <i className={`xp-rail__dot xp-rail__dot--${r.signal}`} aria-hidden />}
                  {r.ticker}
                </span>
                <span className="xp-rail__price num">{price(r.price, r.currency ?? undefined)}</span>
                <span className="xp-rail__name">{r.name ?? ''}</span>
                {r.changePct != null && (
                  <span className={`xp-rail__chg num delta ${r.changePct >= 0 ? 'up' : 'down'}`}>{pct(r.changePct, 2)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
