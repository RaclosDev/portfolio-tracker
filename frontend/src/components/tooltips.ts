/*
 * Tooltips de toda la app con el mismo aspecto que el popover de las notas. Se engancha una vez al
 * documento: al pasar el ratón por algo con `title`, lo pasa a `data-tip` (para que no salga el del
 * navegador, sin formato) y enseña el texto en una caja propia. `data-tip` también se puede poner a
 * mano, p. ej. en SVG, donde `<title>` saca el tooltip nativo.
 */

const DELAY = 350;

export function installTooltips(): void {
  const tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('popover', 'manual');
  tip.id = 'app-tip';
  document.body.append(tip);

  let target: Element | null = null;
  let timer: number | undefined;

  const hide = () => {
    window.clearTimeout(timer);
    target = null;
    if (tip.matches(':popover-open')) tip.hidePopover();
  };

  const place = (el: Element) => {
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  /** El elemento con tooltip más cercano; quita su `title` para que no salga también el nativo. */
  const owner = (from: EventTarget | null): Element | null => {
    const el = from instanceof Element ? from.closest('[title], [data-tip]') : null;
    if (!el || el === tip) return null;
    const title = el.getAttribute('title');
    if (title != null) {
      el.removeAttribute('title');
      if (title.trim()) {
        el.setAttribute('data-tip', title);
        // El title también daba nombre accesible a los botones solo de icono.
        if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim()) {
          el.setAttribute('aria-label', title);
        }
      }
    }
    return el.getAttribute('data-tip')?.trim() ? el : null;
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = owner(e.target);
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    timer = window.setTimeout(() => {
      if (target !== el || !el.isConnected) return;
      tip.textContent = el.getAttribute('data-tip');
      tip.showPopover();
      place(el);
    }, DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (target && !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
