import { Link } from 'react-router';

/** Logo y nombre de la cabecera pública: lleva siempre a la portada. */
export const Brand = () => (
  <Link className="brand lp-brand" to="/">
    <img src="/favicon.svg" alt="" width={28} height={28} />
    <span className="lp-top__name">Portfolio Tracker</span>
  </Link>
);

/** Pantalla de paso al entrar: el logo se queda solo y la app aparece detrás tras recargar (ver Gate). */
export const EnterSplash = ({ label = 'Abriendo tu cartera…', instant = false }: { label?: string; instant?: boolean }) => (
  <div className={`enter-splash${instant ? ' enter-splash--instant' : ''}`} role="status">
    <img src="/favicon.svg" alt="" width={44} height={44} />
    <span className="enter-splash__bar" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </div>
);
