import { Fragment } from 'react';
import { Icon } from './Icon.tsx';
import { useMenuPopover } from './useMenuPopover.ts';

type ListOption = { id: number; name: string; itemCount: number };

/**
 * Selector de lista con el estilo de la app (el `<select>` nativo no se deja maquetar): un botón con la
 * lista actual y un menú con las demás y «Nueva lista…». Menú común en `useMenuPopover`.
 * En la pestaña (`tab`) son dos botones: el nombre abre la lista y el triángulo, el menú.
 */
export function ListMenu({
  lists,
  currentId,
  active,
  variant,
  creating,
  onSelect,
  onNew,
  onRename,
}: {
  lists: ListOption[];
  /** Lista abierta; `null` si se está en otra sección (la cartera). */
  currentId: number | null;
  /** Se está viendo una lista (resalta el botón como la pestaña activa). */
  active: boolean;
  /** `tab`: pestaña de la cabecera del escritorio; `title`: título grande del móvil. */
  variant: 'tab' | 'title';
  creating: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  /** Doble clic en el nombre de la lista abierta (solo en la pestaña). */
  onRename?: () => void;
}) {
  const { id, btn, anchor, pick, menuProps } = useMenuPopover();
  const current = lists.find((l) => l.id === currentId);

  const menuBtn = (
      <button
        ref={btn}
        type="button"
        className={`list-menu__btn list-menu__btn--${variant}${active ? ' tab--active' : ''}`}
        popoverTarget={id}
        aria-haspopup="menu"
        title={current?.name}
      >
        <span className="tab__name">{current?.name ?? 'Listas'}</span>
        <Icon name="chevron" size={18} />
      </button>
  );

  return (
    <>
      {variant === 'tab' ? (
        <span ref={anchor} className={`list-menu__split${active ? ' tab--active' : ''}`}>
          <button
            type="button"
            className="list-menu__open"
            aria-current={active ? 'page' : undefined}
            title={current ? `${current.name} · doble clic para renombrar` : undefined}
            onClick={() => current && onSelect(current.id)}
            onDoubleClick={() => active && onRename?.()}
          >
            <span className="tab__name">{current?.name ?? 'Listas'}</span>
            {current && <span className="tab__count">{current.itemCount}</span>}
          </button>
          <button
            ref={btn}
            type="button"
            className="list-menu__toggle"
            popoverTarget={id}
            aria-haspopup="menu"
            aria-label="Otras listas"
            title="Otras listas"
          >
            <Icon name="chevron" size={14} />
          </button>
        </span>
      ) : (
        menuBtn
      )}
      <div {...menuProps} aria-label="Listas" className="list-menu">
        {lists.map((l, i) => (<Fragment key={l.id}>
          {/* Las listas especiales (id negativo, p. ej. «Visitados») van aparte, tras las propias. */}
          {l.id < 0 && lists[i - 1] && lists[i - 1]!.id > 0 && <hr className="list-menu__sep" />}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={l.id === currentId}
            className="list-menu__item"
            onClick={() => pick(() => onSelect(l.id))}
          >
            <span className="list-menu__check">{l.id === currentId && <Icon name="check" size={14} />}</span>
            <span className="list-menu__name">{l.name}</span>
            <span className="list-menu__count">{l.itemCount}</span>
          </button>
        </Fragment>))}
        <hr className="list-menu__sep" />
        <button type="button" role="menuitem" className="list-menu__item list-menu__item--new" disabled={creating} onClick={() => pick(onNew)}>
          <span className="list-menu__check"><Icon name="plus" size={14} /></span>
          <span className="list-menu__name">Nueva lista…</span>
        </button>
      </div>
    </>
  );
}
