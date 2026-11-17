import { useEffect, useState, type ReactNode } from 'react';
import './landing.css';

/*
 * Portada pública: lo que ve quien llega sin sesión. Explica el producto con la propia interfaz
 * (el mapa de precios, en vivo y con datos ficticios, y capturas reales) y deja el formulario al final.
 */

const eur = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Row = {
  name: string; ticker: string; unit: string; min: number; max: number;
  levels: [number, number]; price: (step: number) => number;
};

/** Recorrido fijo del ejemplo: Iberdrola baja hasta su primer precio de compra; los otros dos oscilan. */
const IBE = [14.21, 14.12, 14.18, 14.02, 13.91, 13.96, 13.8, 13.71, 13.62, 13.66, 13.55, 13.48, 13.46, 13.49, 13.47, 13.48];
const STEPS = IBE.length;
const ROWS: Row[] = [
  { name: 'Iberdrola', ticker: 'IBE.MC', unit: '€', min: 12.2, max: 15.1, levels: [13.5, 12.69], price: (s) => IBE[s]! },
  { name: 'Microsoft', ticker: 'MSFT', unit: '$', min: 370, max: 477, levels: [410, 385.4], price: (s) => 425.6 + 3.2 * Math.sin(s * 1.1) },
  { name: 'Vanguard FTSE All-World', ticker: 'VWCE.DE', unit: '€', min: 108, max: 141, levels: [120, 112.8], price: (s) => 126.3 + 0.9 * Math.cos(s * 0.8) },
];

type Status = 'reached' | 'veryNear' | 'near' | 'far';
const LABEL: Record<Status, string> = { reached: 'En zona de compra', veryNear: 'Muy cerca', near: 'Cerca', far: 'Lejos' };
const statusOf = (gap: number): Status => (gap <= 0 ? 'reached' : gap <= 2 ? 'veryNear' : gap <= 6 ? 'near' : 'far');

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

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

function PriceMap() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(reduced ? STEPS - 1 : 0);
  useEffect(() => {
    if (reduced) { setStep(STEPS - 1); return; }
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS), 1500);
    return () => window.clearInterval(id);
  }, [reduced]);

  const alert = statusOf(((ROWS[0]!.price(step) - ROWS[0]!.levels[0]) / ROWS[0]!.levels[0]) * 100) === 'reached';
  return (
    <figure className="lp-map">
      <ul className="lp-map__rows">
        {ROWS.map((row) => {
          const price = row.price(step);
          const gap = ((price - row.levels[0]) / row.levels[0]) * 100;
          const status = statusOf(gap);
          const at = (v: number) => `${((v - row.min) / (row.max - row.min)) * 100}%`;
          return (
            <li key={row.ticker} className={`lp-map__row lp-map__row--${status}`}>
              <div className="lp-map__name">
                <strong>{row.name}</strong>
                <span className="ticker">{row.ticker}</span>
              </div>
              <div className="lp-map__price">
                <strong>{eur.format(price)} {row.unit}</strong>
                <span className={`lp-map__status lp-map__status--${status}`}>{LABEL[status]}</span>
              </div>
              <div className="lp-map__track" aria-hidden="true">
                <span className="lp-map__zone" style={{ width: at(row.levels[0]) }} />
                {row.levels.map((level, i) => (
                  <span key={level} className="lp-map__level" style={{ left: at(level) }}><i>{i + 1}</i></span>
                ))}
                <span className="lp-map__marker" style={{ left: at(price) }} />
              </div>
              <p className="lp-map__gap">
                {gap <= 0
                  ? `Compra 1 alcanzada · ${eur.format(row.levels[0])} ${row.unit}`
                  : `A ${pct.format(gap)} % de la compra 1 · ${eur.format(row.levels[0])} ${row.unit}`}
              </p>
            </li>
          );
        })}
      </ul>
      <p className={`lp-map__alert${alert ? ' lp-map__alert--on' : ''}`} aria-hidden={!alert}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        Aviso enviado: Iberdrola ha llegado a tu compra 1
      </p>
      <figcaption>Así se ve un valor acercándose a tu precio. Ejemplo con datos ficticios.</figcaption>
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
  return (
    <section className="lp-screens" aria-labelledby="lp-screens-title">
      <h2 id="lp-screens-title">De la lista de vigilancia al registro de operaciones</h2>
      <div className="lp-tabs" role="tablist" aria-label="Pantallas de la aplicación">
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
      <div id="lp-screen" role="tabpanel" aria-labelledby={`lp-tab-${screen.id}`} className="lp-screen">
        <p className="lp-screen__text">{screen.text}</p>
        <div className="lp-screen__frame">
          <img
            key={`${screen.id}-${dark}`} src={`/landing/${screen.id}-${dark ? 'dark' : 'light'}.webp`}
            width={1600} height={1000} loading="lazy" decoding="async"
            alt={`Pantalla «${screen.tab}» de Portfolio Tracker con datos de ejemplo`}
          />
        </div>
      </div>
    </section>
  );
}

export function Landing({ canRegister, onEnter, children }: {
  canRegister: boolean; onEnter: (register: boolean) => void; children: ReactNode;
}) {
  const enter = (register: boolean) => {
    onEnter(register);
    document.getElementById('entrar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('login-email')?.focus({ preventScroll: true }), 450);
  };
  return (
    <div className="lp">
      <header className="lp-top">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span className="lp-top__name">Portfolio Tracker</span>
        </div>
        <nav className="lp-top__nav" aria-label="Acceso">
          <a className="btn btn--ghost" href="/demo">Demo</a>
          <button type="button" className="btn" onClick={() => enter(false)}>Entrar</button>
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero__copy">
            <h1>Ponle precio a tus próximas compras.</h1>
            <p className="lp-hero__lede">
              Portfolio Tracker vigila acciones, ETF y fondos por ti. Marcas hasta tres precios de compra por valor
              y ves de un vistazo cuánto le falta a cada uno. Cuando compras, la misma aplicación lleva tu cartera.
            </p>
            <div className="lp-hero__actions">
              <a className="btn btn--primary lp-btn" href="/demo">Ver la demo</a>
              <button type="button" className="btn lp-btn" onClick={() => enter(canRegister)}>
                {canRegister ? 'Crear cuenta' : 'Entrar'}
              </button>
            </div>
            <p className="lp-hero__note">La demo abre sin registro y con datos ficticios.</p>
          </div>
          <PriceMap />
        </section>

        <Screens />

        <section className="lp-details" aria-labelledby="lp-details-title">
          <h2 id="lp-details-title">Lo que lleva dentro</h2>
          <dl>
            <div><dt>Avisos en el móvil</dt><dd>Una notificación cuando un valor llega al precio que marcaste, sin tener la aplicación abierta.</dd></div>
            <div><dt>Tu histórico, importado</dt><dd>Trae las operaciones que ya tienes desde Excel o CSV en lugar de teclearlas una a una.</dd></div>
            <div><dt>Instalable, en claro y oscuro</dt><dd>Se instala como aplicación en el móvil y en el ordenador y sigue el tema del sistema.</dd></div>
            <div><dt>Copias de seguridad</dt><dd>Tus listas y tu cartera se exportan y se restauran cuando quieras.</dd></div>
          </dl>
          <p className="lp-details__limit">
            Hace seguimiento y nada más: no envía órdenes a ningún bróker ni recomienda qué comprar.
          </p>
        </section>

        <section className="lp-enter" id="entrar" aria-labelledby="lp-enter-title">
          <div className="lp-enter__copy">
            <h2 id="lp-enter-title">Tu cartera, en una cuenta privada</h2>
            <p>Empiezas con una cuenta vacía: añade los valores que sigues, ponles precio y deja que la lista te diga cuándo mirar.</p>
            <p>¿Prefieres verla antes con datos? <a href="/demo">Abre la demo</a>.</p>
          </div>
          {children}
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
