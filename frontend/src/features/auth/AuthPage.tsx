import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ApiError, api, reloadSession } from '../../api/client.ts';
import { Brand, EnterSplash } from './brand.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';
import { safeNext } from './safeNext.ts';
import './landing.css';

/** Marca que la recarga viene de entrar: la app aparece con un fundido en vez de un corte (ver Gate). */
export const ENTERING = 'watchlist.entrando';
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type AuthMode = 'login' | 'register';

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

/** Páginas de acceso: /login (entrar) y /registro (crear cuenta). Tras entrar se va a `?next=` si es de esta web. */
export function AuthPage({ mode, googleClientId, registrationEnabled }: {
  mode: AuthMode; googleClientId: string | null; registrationEnabled: boolean;
}) {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const previous = document.title;
    document.title = `${mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión'} · Portfolio Tracker`;
    window.scrollTo(0, 0);
    document.getElementById('login-email')?.focus({ preventScroll: true });
    return () => { document.title = previous; };
  }, [mode]);

  // La vista se recoge hacia el logo y, al terminar, se recarga ya con la sesión abierta.
  const finish = () => {
    sessionStorage.setItem(ENTERING, '1');
    setLeaving(true);
    const to = safeNext(params.get('next'));
    window.setTimeout(() => reloadSession(to), reducedMotion() ? 0 : 560);
  };

  return (
    <div className={`lp lp--auth${leaving ? ' lp--leaving' : ''}`}>
      <header className="lp-top">
        <Brand />
        <nav className="lp-top__nav" aria-label="Acceso">
          <Link className="btn btn--ghost" to="/">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            Volver
          </Link>
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
        {/* Al pasar entre /login y /registro el formulario empieza de cero, salvo el correo. */}
        <AuthForm key={mode} mode={mode} email={email} onEmail={setEmail} onDone={finish}
          googleClientId={googleClientId} registrationEnabled={registrationEnabled} />
      </main>
      {leaving && <EnterSplash />}
    </div>
  );
}

function AuthForm({ mode, email, onEmail, onDone, googleClientId, registrationEnabled }: {
  mode: AuthMode; email: string; onEmail: (email: string) => void; onDone: () => void;
  googleClientId: string | null; registrationEnabled: boolean;
}) {
  const { search } = useLocation();
  const registering = mode === 'register';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enterWithGoogle = async (credential: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.loginWithGoogle(credential);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo entrar con Google. Vuelve a intentarlo.');
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (registering && password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (registering ? api.register(email, password) : api.login(email, password));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar. Inténtalo de nuevo.');
      setBusy(false);
    }
  };

  return (
    <form className="login__card" onSubmit={submit}>
      <h3 className="login__title">{registering ? 'Crear cuenta' : 'Iniciar sesión'}</h3>
      {registering && <p className="muted small">Tu cartera y tus listas serán privadas. Empieza con una cuenta vacía.</p>}
      <fieldset className="login__fields" disabled={busy}>
      <label htmlFor="login-email">Correo electrónico</label>
      <input
        id="login-email"
        name="email"
        type="email"
        maxLength={254}
        autoComplete="username"
        value={email}
        onChange={(e) => onEmail(e.target.value)}
        required
      />
      <label htmlFor="login-pass">Contraseña</label>
      <input
        id="login-pass"
        name="password"
        type="password"
        autoComplete={registering ? 'new-password' : 'current-password'}
        minLength={registering ? 12 : undefined}
        maxLength={registering ? 72 : 200}
        aria-describedby={registering ? 'password-help' : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {registering && <>
        <p id="password-help" className="muted small">Entre 12 y 72 caracteres. Puedes usar una frase.</p>
        <label htmlFor="login-confirm">Repetir contraseña</label>
        <input id="login-confirm" name="confirmation" type="password" autoComplete="new-password"
          value={confirmation} onChange={(e) => setConfirmation(e.target.value)} maxLength={72} required />
      </>}
      </fieldset>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--primary" disabled={busy || !email || !password}>
        {busy ? (registering ? 'Creando cuenta…' : 'Entrando…') : (registering ? 'Crear cuenta' : 'Entrar')}
      </button>
      {googleClientId && (
        <GoogleSignInButton
          clientId={googleClientId}
          text={registering ? 'signup_with' : 'continue_with'}
          onCredential={(credential) => void enterWithGoogle(credential)}
          onError={() => setError('No se pudo entrar con Google. Vuelve a intentarlo.')}
        />
      )}
      {registrationEnabled && <p className="small login__switch">
        {registering ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
        <Link className="login__link" to={{ pathname: registering ? '/login' : '/registro', search }}
          aria-disabled={busy || undefined} onClick={(e) => { if (busy) e.preventDefault(); }}>
          {registering ? 'Inicia sesión' : 'Crear cuenta'}
        </Link>
      </p>}
      <p className="muted small">La sesión se recuerda en este dispositivo durante 6 meses.</p>
    </form>
  );
}
