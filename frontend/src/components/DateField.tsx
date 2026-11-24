import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { localToday } from '@/shared';
import { Icon } from './Icon.tsx';

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const shown = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/**
 * Campo de fecha con el calendario de la app (el `<input type="date">` abre el del navegador, que no
 * admite estilos). Valor en `AAAA-MM-DD`; vacío si `clearable` y no hay fecha.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  allowed,
  clearable = false,
  id,
  label,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** Días elegibles dentro de [min, max] (p. ej. solo los que tienen dato). */
  allowed?: (date: string) => boolean;
  clearable?: boolean;
  id?: string;
  /** Nombre accesible si no hay `<label>`. */
  label?: string;
  className?: string;
}) {
  const popId = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const today = localToday();
  const start = value || (max && max < today ? max : min && min > today ? min : today);
  const [view, setView] = useState(start.slice(0, 7));

  const [year, month] = view.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const ok = (d: string) => (!min || d >= min) && (!max || d <= max) && (!allowed || allowed(d));
  const prevOff = !!min && iso(year, month - 1, 0) < min;
  const nextOff = !!max && iso(year, month, 1) > max;

  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    const p = pop.current;
    if (!b || !p) return;
    p.style.left = `${Math.min(Math.max(8, b.left), window.innerWidth - p.offsetWidth - 8)}px`;
    const below = window.innerHeight - b.bottom - 8;
    p.style.top = `${below < p.offsetHeight + 6 && b.top > below ? Math.max(8, b.top - 6 - p.offsetHeight) : b.bottom + 6}px`;
  };
  const focusDay = (date: string) => {
    setView(date.slice(0, 7));
    requestAnimationFrame(() => pop.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus());
  };
  const onToggle = (e: SyntheticEvent) => {
    const open = (e.nativeEvent as ToggleEvent).newState === 'open';
    btn.current?.setAttribute('aria-expanded', String(open));
    if (!open) return;
    place();
    focusDay(start);
  };
  const pick = (date: string) => {
    pop.current?.hidePopover();
    if (date !== value) onChange(date);
    btn.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const at = (document.activeElement as HTMLElement | null)?.dataset.date;
    if (!at) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const to = step ? shift(at, step) : e.key === 'PageUp' ? iso(year, month - 2, +at.slice(8)) : e.key === 'PageDown' ? iso(year, month, +at.slice(8)) : null;
    if (!to) return;
    e.preventDefault();
    if ((!min || to >= min) && (!max || to <= max)) focusDay(to);
  };

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        className={`select-menu date-field ${value ? '' : 'date-field--empty'} ${className}`.trim()}
        popoverTarget={popId}
        aria-haspopup="dialog"
        aria-label={label ? `${label}: ${value ? LONG.format(new Date(value)) : 'sin fecha'}` : undefined}
      >
        <span className="select-menu__value">{value ? shown(value) : 'Sin fecha'}</span>
        <Icon name="calendar" size={16} />
      </button>
      <div ref={pop} id={popId} popover="auto" role="dialog" aria-label={label ?? 'Elegir fecha'} className="list-menu date-pop" onToggle={onToggle} onKeyDown={onKeyDown}>
        <div className="date-pop__head">
          <button type="button" className="date-pop__nav date-pop__nav--prev" aria-label="Mes anterior" disabled={prevOff} onClick={() => setView(iso(year, month - 2, 1).slice(0, 7))}>
            <Icon name="chevron" size={16} />
          </button>
          <span className="date-pop__title" aria-live="polite">{MONTH.format(new Date(Date.UTC(year, month - 1, 1)))}</span>
          <button type="button" className="date-pop__nav date-pop__nav--next" aria-label="Mes siguiente" disabled={nextOff} onClick={() => setView(iso(year, month, 1).slice(0, 7))}>
            <Icon name="chevron" size={16} />
          </button>
        </div>
        <div className="date-pop__grid">
          {DOW.map((d, i) => <span key={i} className="date-pop__dow" aria-hidden>{d}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const date = `${view}-${pad(i + 1)}`;
            return (
              <button
                key={date}
                type="button"
                className="date-pop__day"
                data-date={date}
                disabled={!ok(date)}
                aria-pressed={date === value}
                aria-current={date === today ? 'date' : undefined}
                aria-label={LONG.format(new Date(date))}
                onClick={() => pick(date)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        {(ok(today) || (clearable && value)) && (
          <div className="date-pop__foot">
            {clearable && value ? <button type="button" className="date-pop__link" onClick={() => pick('')}>Quitar fecha</button> : <span />}
            {ok(today) && <button type="button" className="date-pop__link" onClick={() => pick(today)}>Hoy</button>}
          </div>
        )}
      </div>
    </>
  );
}
