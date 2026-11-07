import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface TourStep {
  /** Selector CSS (o varios: se usa el primero que exista). Sin target = paso centrado. */
  target?: string | string[];
  title: string;
  body: ReactNode;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 12;
const MARGIN = 12;

function findTarget(step: TourStep | undefined): HTMLElement | null {
  if (!step?.target) return null;
  for (const sel of ([] as string[]).concat(step.target)) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.getClientRects().length) return el;
  }
  return null;
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * Tour guiado sin dependencias: oscurece la página, resalta el elemento del paso
 * y muestra una ficha con la explicación. Teclado: ← → para moverse, Esc para salir.
 */
export function Tour({ steps: allSteps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  // Los pasos cuyo elemento no existe (p. ej. no hay órdenes activas) se omiten.
  const steps = useMemo(() => allSteps.filter((s) => !s.target || findTarget(s)), [allSteps]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popSize, setPopSize] = useState({ w: 360, h: 200 });
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  const go = (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), steps.length - 1));
  const next = () => (isLast ? onClose() : go(1));

  // Al cambiar de paso: llevar el elemento a la vista y enfocar "Siguiente".
  useEffect(() => {
    const el = findTarget(step);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
    nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Seguir la posición del elemento (scroll, redimensionado, refrescos de datos).
  useEffect(() => {
    let raf = 0;
    let last: Rect | null = null;
    const tick = () => {
      const el = findTarget(step);
      const r = el?.getBoundingClientRect();
      const nextRect = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      if (!sameRect(last, nextRect)) setRect((last = nextRect));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => {
    const el = popRef.current;
    if (el && (el.offsetWidth !== popSize.w || el.offsetHeight !== popSize.h)) {
      setPopSize({ w: el.offsetWidth, h: el.offsetHeight });
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!step) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

  let popStyle: CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + PAD + GAP;
    const above = rect.top - PAD - GAP - popSize.h;
    const top =
      below + popSize.h <= vh - MARGIN ? below : above >= MARGIN ? above : clamp(vh - popSize.h - MARGIN, MARGIN, vh);
    const left = clamp(rect.left + rect.width / 2 - popSize.w / 2, MARGIN, vw - popSize.w - MARGIN);
    popStyle = { top, left };
  } else {
    popStyle = { top: Math.max(MARGIN, (vh - popSize.h) / 2), left: Math.max(MARGIN, (vw - popSize.w) / 2) };
  }

  return (
    <div className="tour" aria-live="polite">
      <div className={`tour__backdrop${rect ? '' : ' tour__backdrop--dim'}`} />
      {rect && (
        <div
          className="tour__spot"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      )}
      <div
        ref={popRef}
        className="tour__pop"
        style={popStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
      >
        <div className="tour__progress" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />
          ))}
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <div id="tour-body" className="tour__body">
          {step.body}
        </div>
        <footer className="tour__footer">
          <span className="muted small">
            {index + 1} / {steps.length}
          </span>
          <span className="spacer" />
          {!isLast && (
            <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
              Saltar
            </button>
          )}
          {index > 0 && (
            <button type="button" className="btn btn--small" onClick={() => go(-1)}>
              Anterior
            </button>
          )}
          <button ref={nextRef} type="button" className="btn btn--small btn--primary" onClick={next}>
            {isLast ? 'Terminar' : 'Siguiente'}
          </button>
        </footer>
      </div>
    </div>
  );
}
