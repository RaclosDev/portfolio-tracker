import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import './landing.css';

/*
 * Portada pública: lo que ve quien llega sin sesión. Explica el producto con la propia interfaz
 * (el mapa de precios, con la última sesión real, y capturas de la demo) y abre la entrada en su propia vista, /login.
 */

const eur = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Row = { name: string; ticker: string; unit: string; min: number; max: number; levels: number[]; path: number[] };

const STEPS = 24;
/** Recorrido de reserva (sin conexión): Iberdrola baja hasta su primer precio de compra; los otros dos oscilan. */
const IBE = [14.21, 14.12, 14.18, 14.02, 13.91, 13.96, 13.8, 13.71, 13.62, 13.66, 13.55, 13.48, 13.46, 13.49, 13.47, 13.48];
const wave = (base: number, amp: number, speed: number) => Array.from({ length: STEPS }, (_, s) => base + amp * Math.sin(s * speed));
/** Iberdrola va la última: cuando llega a su compra 1 sube arriba, como en la lista de la aplicación. */
const FALLBACK: Row[] = [
  { name: 'Microsoft', ticker: 'MSFT', unit: '$', min: 340, max: 445, levels: [410, 385.4, 362], path: wave(425.6, 3.2, 1.1) },
  { name: 'Vanguard FTSE All-World', ticker: 'VWCE.DE', unit: '€', min: 92, max: 132, levels: [116, 108, 100], path: wave(126.3, 0.9, 0.8) },
  { name: 'Iberdrola', ticker: 'IBE.MC', unit: '€', min: 11.5, max: 14.6, levels: [13.5, 12.83, 12.15], path: Array.from({ length: STEPS }, (_, s) => IBE[Math.min(s, IBE.length - 1)]!) },
];
const LEAD = 'IBE.MC';

type Candle = { t: string; c: number };
type Snapshot = { quotes: Record<string, { name?: string; currency?: string; price?: number }>; candles: Record<string, Candle[]> };
const NAMES: Record<string, string> = { MSFT: 'Microsoft', 'VWCE.DE': 'Vanguard FTSE All-World', 'IBE.MC': 'Iberdrola' };
const UNITS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
/** Distancia del primer precio de compra a la cotización de hoy, para que se vean estados distintos. */
const FIRST_LEVEL: Record<string, number> = { MSFT: 0.965, 'VWCE.DE': 0.915 };

/** La última sesión de cada valor, en STEPS puntos; los precios de compra se colocan respecto a ella. */
function realRows(snap: Snapshot): Row[] | null {
  const rows = Object.keys(NAMES).map((ticker): Row | null => {
    const bars = snap.candles[ticker] ?? [];
    const day = bars.at(-1)?.t.slice(0, 10);
    const session = bars.filter((b) => b.t.startsWith(day ?? '-')).map((b) => b.c);
    const quote = snap.quotes[ticker];
    if (session.length < 6 || !quote?.price) return null;
    const path = Array.from({ length: STEPS }, (_, i) => session[Math.round((i * (session.length - 1)) / (STEPS - 1))]!);
    path[STEPS - 1] = quote.price;
    const sorted = [...path].sort((x, y) => x - y);
    // Iberdrola: su primer nivel cae en el cuarto más bajo de la sesión, así que lo alcanza y salta el aviso.
    const first = FIRST_LEVEL[ticker]
      ? quote.price * FIRST_LEVEL[ticker]!
      : sorted[Math.floor(STEPS / 4)]! + (sorted.at(-1)! - sorted[0]!) * 0.02;
    const levels = [first, first * 0.95, first * 0.9];
    return {
      name: NAMES[ticker]!, ticker, unit: UNITS[quote.currency ?? 'EUR'] ?? quote.currency ?? '',
      min: levels[2]! * 0.95, max: sorted.at(-1)! * 1.04, levels, path,
    };
  });
  return rows.every(Boolean) ? (rows as Row[]) : null;
}

/** Las filas reales, y si ya se sabe qué enseñar: el mapa espera a los datos (o a 1,2 s) antes de dibujarse. */
function useLandingRows() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => setSettled(true), 1200);
    fetch('/api/public/market/landing', { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))
      .then((snap) => { if (snap) setRows(realRows(snap)); })
      .catch(() => { /* sin conexión: el ejemplo de reserva */ })
      .finally(() => { if (!ctrl.signal.aborted) setSettled(true); });
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, []);
  return { rows, settled };
}

/** El número va de un precio al siguiente como una cotización que se mueve, no a saltos. */
function useTweened(target: number, ms: number, off: boolean) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (off) { current.current = target; setValue(target); return; }
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      current.current = from + (target - from) * (1 - (1 - k) ** 4);
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, off]);
  return value;
}

/** Solo corre mientras se ve: fuera de pantalla o con la pestaña oculta, el recorrido se para. */
function useOnScreen(ref: RefObject<Element | null>) {
  const [inView, setInView] = useState(true);
  const [shown, setShown] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const el = ref.current;
    const onVis = () => setShown(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    const io = el && 'IntersectionObserver' in window
      ? new IntersectionObserver(([e]) => setInView(e!.isIntersecting), { threshold: 0.15 })
      : null;
    if (el) io?.observe(el);
    return () => { document.removeEventListener('visibilitychange', onVis); io?.disconnect(); };
  }, [ref]);
  return inView && shown;
}

/** Las mismas bandas que trae la aplicación por defecto: 5, 10 y 20 %. */
type Status = 'reached' | 'veryNear' | 'near' | 'far' | 'veryFar';
const LABEL: Record<Status, string> = { reached: 'En zona de compra', veryNear: 'Muy cerca', near: 'Cerca', far: 'Lejos', veryFar: 'Muy lejos' };
const statusOf = (gap: number): Status => (gap <= 0 ? 'reached' : gap <= 5 ? 'veryNear' : gap <= 10 ? 'near' : gap <= 20 ? 'far' : 'veryFar');
const gapTo = (price: number, level: number) => ((price - level) / level) * 100;

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

function useDark() {
  const read = () => {
    const forced = document.documentElement.dataset.theme;
    return forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(read());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

const RANK: Status[] = ['reached', 'veryNear', 'near', 'far', 'veryFar'];
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

function MapRow({ row, step, reduced, rowRef }: {
  row: Row; step: number; reduced: boolean; rowRef: (el: HTMLLIElement | null) => void;
}) {
  const target = row.path[step]!;
  const shown = useTweened(target, 900, reduced);
  const prev = useRef(target);
  const dir = target > prev.current ? 'up' : target < prev.current ? 'down' : 'flat';
  useEffect(() => { prev.current = target; }, [target]);

  const gap = gapTo(target, row.levels[0]!);
  const status = statusOf(gap);
  const at = (v: number) => `${((v - row.min) / (row.max - row.min)) * 100}%`;
  return (
    <li ref={rowRef} className={`lp-map__row lp-map__row--${status}`}>
      <div className="lp-map__name">
        <strong>{row.name}</strong>
        <span className="ticker">{row.ticker}</span>
      </div>
      <div className="lp-map__price">
        {/* La clave cambia en cada paso: el destello verde o rojo vuelve a empezar con cada cotización. */}
        <strong key={step} className={`lp-map__quote lp-map__quote--${dir}`}>{eur.format(shown)} {row.unit}</strong>
        <span className={`lp-map__status lp-map__status--${status}`}>{LABEL[status]}</span>
      </div>
      <div className="lp-map__track" aria-hidden="true">
        <span className="lp-map__zone" style={{ width: at(row.levels[0]!) }} />
        {row.levels.map((level, i) => (
          <span
            key={i} className={`lp-map__level lp-map__level--${statusOf(gapTo(target, level))}`}
            style={{ left: at(level), '--i': i } as CSSProperties}
          ><i>{i + 1}</i></span>
        ))}
        <span className="lp-map__marker" style={{ left: at(shown) }} />
      </div>
      <p className="lp-map__gap">
        {gap <= 0
          ? `Compra 1 alcanzada · ${eur.format(row.levels[0]!)} ${row.unit}`
          : `A ${pct.format(gap)} % de la compra 1 · ${eur.format(row.levels[0]!)} ${row.unit}`}
      </p>
    </li>
  );
}

function PriceMap() {
  const reduced = useReducedMotion();
  const { rows: real, settled } = useLandingRows();
  const rows = real ?? FALLBACK;
  const figure = useRef<HTMLElement>(null);
  // Mover una fila en el DOM reinicia sus animaciones CSS: la entrada se apaga en cuanto ha terminado.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    if (!settled) return;
    const id = window.setTimeout(() => setDrawn(true), 1400);
    return () => window.clearTimeout(id);
  }, [settled, real]);
  const running = useOnScreen(figure) && drawn && !reduced;
  const [step, setStep] = useState(reduced ? STEPS - 1 : 0);
  useEffect(() => { setStep(reduced ? STEPS - 1 : 0); }, [reduced, real]);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS), 1100);
    return () => window.clearInterval(id);
  }, [running]);

  // Como en la lista: los valores en zona de compra suben arriba; a igual estado se respeta el orden.
  const ordered = [...rows].sort((a, b) =>
    RANK.indexOf(statusOf(gapTo(a.path[step]!, a.levels[0]!))) - RANK.indexOf(statusOf(gapTo(b.path[step]!, b.levels[0]!))));
  const order = ordered.map((r) => r.ticker).join();

  // FLIP: cada fila sale de donde estaba y se desliza a su nuevo sitio.
  const els = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const source = useRef(real);
  useLayoutEffect(() => {
    // Al llegar los datos reales la lista se monta de nuevo: se anotan las posiciones sin animar.
    const fresh = source.current !== real;
    source.current = real;
    els.current.forEach((el, ticker) => {
      const top = el.offsetTop;
      const before = tops.current.get(ticker);
      tops.current.set(ticker, top);
      if (fresh || reduced || before === undefined || before === top) return;
      el.style.zIndex = before > top ? '2' : '1';
      el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: 640, easing: EASE_OUT })
        .finished.then(() => { el.style.zIndex = ''; }, () => {});
    });
  }, [order, reduced, real]);

  const lead = rows.find((r) => r.ticker === LEAD)!;
  const alert = statusOf(gapTo(lead.path[step]!, lead.levels[0]!)) === 'reached';
  return (
    <figure ref={figure} className={`lp-map${settled ? ' lp-map--ready' : ''}${drawn ? ' lp-map--drawn' : ''}`}>
      <ul key={real ? 'real' : 'demo'} className="lp-map__rows">
        {ordered.map((row) => (
          <MapRow
            key={row.ticker} row={row} step={step} reduced={reduced}
            rowRef={(el) => { if (el) els.current.set(row.ticker, el); else els.current.delete(row.ticker); }}
          />
        ))}
      </ul>
      <p className={`lp-map__alert${alert ? ' lp-map__alert--on' : ''}`} aria-hidden={!alert}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        Aviso enviado: {lead.name} ha llegado a tu compra 1
      </p>
      <figcaption>
        Así se ve un valor acercándose a tu precio.{' '}
        {real ? 'Cotizaciones reales de la última sesión; los precios de compra son de ejemplo.' : 'Ejemplo con datos ficticios.'}
      </figcaption>
    </figure>
  );
}

const SCREENS = [
  { id: 'watchlist', tab: 'Vigilancia', text: 'Cada valor con sus precios de compra y un mapa que enseña dónde está la cotización respecto a ellos. Los que entran en zona suben arriba.' },
  { id: 'portfolio', tab: 'Cartera', text: 'Ganancia total, TIR anual y de dónde sale cada euro: lo latente, lo ganado en ventas y lo cobrado.' },
  { id: 'positions', tab: 'Posiciones', text: 'Qué tienes, a qué precio medio lo compraste y cuánto pesa cada posición en el conjunto.' },
  { id: 'operations', tab: 'Registro', text: 'Compras, ventas, dividendos, scrip y splits en un solo registro. Las ventas se casan con las compras por FIFO.' },
] as const;

function Screens() {
  const dark = useDark();
  const [active, setActive] = useState(0);
  const screen = SCREENS[active]!;
  // En pantallas anchas va la demo de verdad; en el móvil no cabe usable y se queda la captura.
  const live = useMedia('(min-width: 1024px)');
  // La demo pesa: se empieza a cargar cuando la portada ya ha terminado, sin esperar al scroll. Primero la
  // pestaña abierta y luego, una tras otra, las demás, para que cambiar de pestaña sea instantáneo.
  const [mounted, setMounted] = useState<string[]>([]);
  const [pageLoaded, setPageLoaded] = useState(false);
  useEffect(() => {
    if (!live) return;
    // Safari no tiene requestIdleCallback: ahí basta con dejar respirar a la página un momento.
    const hasIdle = typeof window.requestIdleCallback === 'function';
    let idle = 0;
    const start = () => {
      idle = hasIdle
        ? window.requestIdleCallback(() => setPageLoaded(true), { timeout: 1500 })
        : window.setTimeout(() => setPageLoaded(true), 300);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      if (hasIdle) window.cancelIdleCallback(idle); else window.clearTimeout(idle);
    };
  }, [live]);
  useEffect(() => {
    if (pageLoaded) setMounted((m) => (m.includes(screen.id) ? m : [...m, screen.id]));
  }, [pageLoaded, screen.id]);
  const preloadNext = useCallback(() => {
    setMounted((m) => {
      const next = SCREENS.find((s) => !m.includes(s.id));
      return next ? [...m, next.id] : m;
    });
  }, []);
  // La pastilla de la pestaña activa se desliza hasta la elegida en lugar de saltar.
  const tabs = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const box = tabs.current;
    if (!box) return;
    const measure = () => {
      const tab = box.querySelector<HTMLElement>('[aria-selected="true"]');
      if (tab) setPill({ x: tab.offsetLeft, w: tab.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [active]);
  return (
    <section className="lp-screens" aria-labelledby="lp-screens-title">
      <div className="lp-screens__head" data-reveal>
        <h2 id="lp-screens-title">De la lista de vigilancia al registro de operaciones</h2>
        <div className="lp-screens__demo">
          {live && <span className="lp-live-chip"><i aria-hidden="true" />Demo en directo</span>}
          <a className="btn" href="/demo">
            {live ? 'Abrir la demo' : 'Probar la demo'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
          </a>
        </div>
      </div>
      <div
        ref={tabs} data-reveal className={`lp-tabs${pill ? ' lp-tabs--pill' : ''}`} role="tablist" aria-label="Pantallas de la aplicación"
        style={pill ? ({ '--pill-x': `${pill.x}px`, '--pill-w': `${pill.w}px` } as CSSProperties) : undefined}
      >
        <span className="lp-tabs__pill" aria-hidden="true" />
        {SCREENS.map((s, i) => (
          <button
            key={s.id} type="button" role="tab" id={`lp-tab-${s.id}`} aria-selected={i === active} aria-controls="lp-screen"
            tabIndex={i === active ? 0 : -1} className={`lp-tab${i === active ? ' lp-tab--active' : ''}`}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!move) return;
              const next = (i + move + SCREENS.length) % SCREENS.length;
              setActive(next);
              document.getElementById(`lp-tab-${SCREENS[next]!.id}`)?.focus();
            }}
          >{s.tab}</button>
        ))}
      </div>
      <div id="lp-screen" data-reveal role="tabpanel" aria-labelledby={`lp-tab-${screen.id}`} className="lp-screen">
        <p key={screen.id} className="lp-screen__text">{screen.text}</p>
        <div className={`lp-screen__frame${live ? ' lp-screen__frame--live' : ''}`}>
          <img
            key={`${screen.id}-${dark}`} src={`/landing/${screen.id}-${dark ? 'dark' : 'light'}.webp`}
            width={1600} height={1000} loading="lazy" decoding="async"
            alt={live ? '' : `Pantalla «${screen.tab}» de Portfolio Tracker con datos de ejemplo`}
          />
          {live && SCREENS.filter((s) => mounted.includes(s.id)).map((s) => (
            <LiveDemo key={s.id} view={s.id} label={s.tab} active={s.id === screen.id} onReady={preloadNext} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * La demo dentro de la portada: aparece sobre la captura cuando ya ha pintado sus datos y su pestaña está
 * abierta. Va en su propia memoria (ver demo/embed.ts), así que no toca nada del visitante.
 */
function LiveDemo({ view, label, active, onReady }: { view: string; label: string; active: boolean; onReady: () => void }) {
  const [ready, setReady] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // El documento carga antes de que la app pinte: se espera a que no quede la pantalla de carga (máx. 6 s).
  const waitForApp = (frame: HTMLIFrameElement, since = Date.now()) => {
    const doc = frame.contentDocument;
    const painted = doc?.getElementById('root')?.firstElementChild && !doc.querySelector('.enter-splash');
    if (painted || Date.now() - since > 6000) {
      timer.current = window.setTimeout(() => { setReady(true); onReady(); }, 250);
      return;
    }
    timer.current = window.setTimeout(() => waitForApp(frame, since), 120);
  };
  return (
    <iframe
      className={`lp-live${ready && active ? ' lp-live--ready' : ''}`}
      src={`/demo?vista=${view}`} title={`Demo de Portfolio Tracker: ${label}`}
      aria-hidden={!active || undefined} tabIndex={active ? undefined : -1} inert={!active}
      onLoad={(e) => waitForApp(e.currentTarget)}
    />
  );
}

export const AUTH_PATH = '/login';
const onAuthPath = () => window.location.pathname === AUTH_PATH;

/** La entrada vive en su propia vista (/login): se abre sin bajar por la página y «atrás» vuelve a la portada. */
function useAuthView(onEnter: (register: boolean) => void) {
  const [open, setOpen] = useState(onAuthPath);
  useEffect(() => {
    const sync = () => setOpen(onAuthPath());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    if (!open) return;
    window.scrollTo(0, 0);
    document.getElementById('login-email')?.focus({ preventScroll: true });
  }, [open]);
  const enter = (register: boolean) => {
    onEnter(register);
    if (!onAuthPath()) window.history.pushState({ lp: 'auth' }, '', AUTH_PATH);
    setOpen(true);
  };
  const leave = () => {
    if ((window.history.state as { lp?: string } | null)?.lp === 'auth') { window.history.back(); return; }
    window.history.replaceState(null, '', '/');
    setOpen(false);
  };
  return { open, enter, leave };
}

const Brand = ({ onClick }: { onClick?: () => void }) => (
  <a className="brand lp-brand" href="/" onClick={onClick && ((e) => { e.preventDefault(); onClick(); })}>
    <img src="/favicon.svg" alt="" width={28} height={28} />
    <span className="lp-top__name">Portfolio Tracker</span>
  </a>
);

/**
 * Lo marcado con data-reveal entra con un fundido al aparecer en pantalla, una sola vez. Solo se esconde si hay
 * con qué enseñarlo (IntersectionObserver y movimiento permitido): sin eso, todo está visible desde el principio.
 */
function useReveal(root: RefObject<HTMLElement | null>, active: boolean) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !active || reduced || !('IntersectionObserver' in window)) return;
    el.classList.add('lp--reveal');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        // Lo que ya quedó por encima (al recargar a media página) se enseña sin esperar.
        if (e.isIntersecting || e.boundingClientRect.top < 0) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    el.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n));
    return () => { io.disconnect(); el.classList.remove('lp--reveal'); };
  }, [root, active, reduced]);
}

const HEADLINE = 'Ponle precio a tus próximas compras.';

const icon = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

const PERKS = [
  {
    title: 'Precios de compra por niveles. ',
    text: 'Ves de un vistazo qué valores se acercan a tu zona.',
    icon: icon(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>),
  },
  {
    title: 'Avisos en el móvil. ',
    text: 'Te llega uno cuando un valor entra en zona de compra.',
    icon: icon(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
  },
  {
    title: 'Cartera y operaciones. ',
    text: 'Posiciones, rentabilidad y el registro de cada compra y venta.',
    icon: icon(<><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></>),
  },
];

/** Pantalla de paso al entrar: el logo se queda solo y la app aparece detrás tras recargar (ver Gate). */
export const EnterSplash = ({ label = 'Abriendo tu cartera…', instant = false }: { label?: string; instant?: boolean }) => (
  <div className={`enter-splash${instant ? ' enter-splash--instant' : ''}`} role="status">
    <img src="/favicon.svg" alt="" width={44} height={44} />
    <span className="enter-splash__bar" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </div>
);

export function Landing({ canRegister, onEnter, leaving = false, children }: {
  canRegister: boolean; onEnter: (register: boolean) => void; leaving?: boolean; children: ReactNode;
}) {
  const { open, enter, leave } = useAuthView(onEnter);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root, !open);

  if (open) {
    return (
      <div className={`lp lp--auth${leaving ? ' lp--leaving' : ''}`}>
        <header className="lp-top">
          <Brand onClick={leave} />
          <nav className="lp-top__nav" aria-label="Acceso">
            <button type="button" className="btn btn--ghost" onClick={leave}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              Volver
            </button>
          </nav>
        </header>
        <main className="lp-auth" inert={leaving}>
          <div className="lp-auth__copy">
            <h1 className="lp-intro">Tu cartera, en una cuenta privada</h1>
            <p className="lp-intro" style={{ '--d': '80ms' } as CSSProperties}>
              Empiezas con una cuenta vacía: añade los valores que sigues y ponles precio.
            </p>
            <ul className="lp-auth__perks">
              {PERKS.map((perk, i) => (
                <li key={perk.title} className="lp-intro" style={{ '--d': `${180 + i * 90}ms` } as CSSProperties}>
                  <span className="lp-auth__icon" aria-hidden="true">{perk.icon}</span>
                  <span><strong>{perk.title}</strong>{perk.text}</span>
                </li>
              ))}
            </ul>
            <p className="lp-auth__demo lp-intro" style={{ '--d': '480ms' } as CSSProperties}>
              ¿Prefieres verla antes con datos? <a href="/demo">Abre la demo</a>
            </p>
          </div>
          {children}
        </main>
        {leaving && <EnterSplash />}
      </div>
    );
  }

  return (
    <div className="lp" ref={root}>
      <header className="lp-top lp-intro">
        <Brand />
        <nav className="lp-top__nav" aria-label="Portada">
          <div className="lp-top__links">
            <a className="btn btn--ghost" href="#lp-screens-title">Pantallas</a>
            <a className="btn btn--ghost" href="#lp-details-title">Funciones</a>
          </div>
          <a className="btn btn--ghost" href="/demo">Demo</a>
          <a className="btn" href={AUTH_PATH} onClick={(e) => { e.preventDefault(); enter(false); }}>Entrar</a>
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero__copy">
            <h1 className="lp-split" aria-label={HEADLINE}>
              {HEADLINE.split(' ').map((word, i) => (
                <Fragment key={i}>
                  {i > 0 && ' '}
                  <span className="lp-split__w" aria-hidden="true">
                    <span style={{ '--i': i } as CSSProperties}>{word}</span>
                  </span>
                </Fragment>
              ))}
            </h1>
            <p className="lp-hero__lede lp-intro" style={{ '--d': '380ms' } as CSSProperties}>
              Portfolio Tracker vigila acciones, ETF y fondos por ti. Marcas hasta tres precios de compra por valor
              y ves de un vistazo cuánto le falta a cada uno. Cuando compras, la misma aplicación lleva tu cartera.
            </p>
            <div className="lp-hero__actions lp-intro" style={{ '--d': '480ms' } as CSSProperties}>
              <a className="btn btn--primary lp-btn" href="/demo">Ver la demo</a>
              <button type="button" className="btn lp-btn" onClick={() => enter(canRegister)}>
                {canRegister ? 'Crear cuenta' : 'Entrar'}
              </button>
            </div>
            <p className="lp-hero__note lp-intro" style={{ '--d': '560ms' } as CSSProperties}>La demo abre sin registro y con datos ficticios.</p>
          </div>
          <PriceMap />
        </section>

        <Screens />

        <section className="lp-details" aria-labelledby="lp-details-title">
          <h2 id="lp-details-title" data-reveal>Lo que lleva dentro</h2>
          <dl>
            <div data-reveal style={{ '--i': 0 } as CSSProperties}><dt>Avisos en el móvil</dt><dd>Una notificación cuando un valor llega al precio que marcaste, sin tener la aplicación abierta.</dd></div>
            <div data-reveal style={{ '--i': 1 } as CSSProperties}><dt>Tu histórico, importado</dt><dd>Trae las operaciones que ya tienes desde Excel o CSV en lugar de teclearlas una a una.</dd></div>
            <div data-reveal style={{ '--i': 2 } as CSSProperties}><dt>Instalable, en claro y oscuro</dt><dd>Se instala como aplicación en el móvil y en el ordenador y sigue el tema del sistema.</dd></div>
            <div data-reveal style={{ '--i': 3 } as CSSProperties}><dt>Copias de seguridad</dt><dd>Tus listas y tu cartera se exportan y se restauran cuando quieras.</dd></div>
          </dl>
          <p className="lp-details__limit" data-reveal>
            Hace seguimiento y nada más: no envía órdenes a ningún bróker ni recomienda qué comprar.
          </p>
        </section>

        <section className="lp-cta" data-reveal aria-labelledby="lp-cta-title">
          <div>
            <h2 id="lp-cta-title">Tu cartera, en una cuenta privada</h2>
            <p>Empiezas con una cuenta vacía: añade los valores que sigues, ponles precio y deja que la lista te diga cuándo mirar.</p>
          </div>
          <div className="lp-hero__actions">
            <button type="button" className="btn btn--primary lp-btn" onClick={() => enter(canRegister)}>
              {canRegister ? 'Crear cuenta' : 'Entrar'}
            </button>
            {canRegister && <button type="button" className="btn lp-btn" onClick={() => enter(false)}>Ya tengo cuenta</button>}
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span>Portfolio Tracker</span>
        <nav aria-label="Información de la aplicación">
          <a href="/privacidad.html">Privacidad</a>
          <a href="/condiciones.html">Condiciones de uso</a>
          <a href="https://github.com/RaclosDev/portfolio-tracker" rel="noopener">Código en GitHub</a>
        </nav>
      </footer>
    </div>
  );
}
