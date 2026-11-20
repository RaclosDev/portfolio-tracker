import { Icon } from './Icon.tsx';
import { useMenuPopover } from './useMenuPopover.ts';

export type SelectOption<T extends string | number> = { value: T; label: string };

/**
 * Desplegable de filtro con el mismo menú que el selector de listas (el `<select>` nativo abre la lista
 * del sistema, distinta en cada navegador). Los formularios de los diálogos siguen con `<select>`.
 */
export function SelectMenu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
  className = '',
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Nombre accesible del botón (si no hay `<label htmlFor>`). */
  label?: string;
  id?: string;
  className?: string;
}) {
  const menu = useMenuPopover(160);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <>
      <button
        ref={menu.btn}
        id={id}
        type="button"
        className={`select-menu ${className}`.trim()}
        popoverTarget={menu.id}
        aria-haspopup="menu"
        aria-label={label ? `${label}: ${current?.label ?? ''}` : undefined}
      >
        <span className="select-menu__value">{current?.label}</span>
        <Icon name="chevron" size={16} />
      </button>
      <div {...menu.menuProps} aria-label={label} className="list-menu">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="menuitemradio"
            aria-checked={o.value === value}
            className="list-menu__item"
            onClick={() => menu.pick(() => onChange(o.value))}
          >
            <span className="list-menu__check">{o.value === value && <Icon name="check" size={14} />}</span>
            <span className="list-menu__name">{o.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
