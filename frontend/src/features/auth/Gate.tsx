import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useState, type FormEvent, type ReactNode } from 'react';
import { seedFirstScreen } from '../../api/bootstrap.ts';
import { ApiError, AUTH_CHANGED, DEMO, SESSION_LOST, api, reloadSession } from '../../api/client.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';
import { AUTH_PATH, EnterSplash, Landing } from './Landing.tsx';

/** Marca que la recarga viene de entrar: la app aparece con un fundido en vez de un corte. */
const ENTERING = 'watchlist.entrando';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Muestra la app solo con la sesión iniciada; si no, la pantalla de entrada. */
export function Gate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity, refetchOnWindowFocus: 'always', retry: 2 });
  const [initialAccount, setInitialAccount] = useState<string>();
  const accountId = session.data ? session.data.user?.id ?? 'anonymous' : undefined;
  useEffect(() => {
    if (!accountId) return;
    if (initialAccount && initialAccount !== accountId) { window.location.reload(); return; }
    setInitialAccount(accountId);
    if (localStorage.getItem(AUTH_CHANGED) !== accountId) localStorage.setItem(AUTH_CHANGED, accountId);
  }, [accountId, initialAccount]);

  useEffect(() => {
    const lost = () => {
      qc.setQueryData<Awaited<ReturnType<typeof api.session>>>(['session'], (previous) => previous && {
        ...previous, authenticated: false,
      });
    };
    window.addEventListener(SESSION_LOST, lost);
    const changed = (event: StorageEvent) => { if (event.key === AUTH_CHANGED) window.location.reload(); };
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(SESSION_LOST, lost);
      window.removeEventListener('storage', changed);
    };
  }, [qc]);

  const authenticated = session.data?.authenticated === true;
  // Con sesión, la primera pantalla llega en una sola petición y la app se monta con todo ya en la caché.
  const firstScreen = useQuery({
    queryKey: ['bootstrap', accountId],
    queryFn: () => seedFirstScreen(qc),
    enabled: authenticated && !DEMO,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useLayoutEffect(() => {
    if (!authenticated || sessionStorage.getItem(ENTERING) === null) return;
    sessionStorage.removeItem(ENTERING);
    if (reducedMotion()) return;
    const root = document.documentElement;
    root.classList.add('is-entering');
    const t = window.setTimeout(() => root.classList.remove('is-entering'), 900);
    return () => { window.clearTimeout(t); root.classList.remove('is-entering'); };
  }, [authenticated]);

  if (session.isPending) return <EnterSplash label="Cargando…" instant={sessionStorage.getItem(ENTERING) !== null} />;
  if (session.isError) {
    return (
      <main className="login">
        <div className="login__card">
          <h1>Portfolio Tracker</h1>
          <p className="error-box">No se puede conectar con el servidor. Si acaba de arrancar, espera unos segundos.</p>
          <button type="button" className="btn btn--primary" onClick={() => void session.refetch()}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }
  if (!session.data.authenticated) {
    return (
      <Login
        googleClientId={session.data.googleClientId}
        registrationEnabled={session.data.registrationEnabled}
        onDone={reloadSession}
      />
    );
  }
  if (!DEMO && firstScreen.isPending) return <EnterSplash label="Cargando…" instant />;
  if (window.location.pathname === AUTH_PATH) window.history.replaceState(null, '', '/');
  return <>{children}</>;
}

function Login({ googleClientId, registrationEnabled, onDone }: {
  googleClientId: string | null; registrationEnabled: boolean; onDone: () => void;
}) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // La vista se recoge hacia el logo y, al terminar, se recarga ya con la sesión abierta.
  const finish = () => {
    sessionStorage.setItem(ENTERING, '1');
    setLeaving(true);
    window.setTimeout(onDone, reducedMotion() ? 0 : 560);
  };

  const enterWithGoogle = async (credential: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.loginWithGoogle(credential);
      finish();
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
      finish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar. Inténtalo de nuevo.');
      setBusy(false);
    }
  };

  return (
    <Landing
      canRegister={registrationEnabled}
      leaving={leaving}
      onEnter={(register) => {
        if (register !== registering) { setRegistering(register); setPassword(''); setConfirmation(''); setError(null); }
      }}
    >
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
          onChange={(e) => setEmail(e.target.value)}
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
          <button type="button" className="login__link" disabled={busy} onClick={() => {
            setRegistering(!registering); setPassword(''); setConfirmation(''); setError(null);
          }}>{registering ? 'Inicia sesión' : 'Crear cuenta'}</button>
        </p>}
        <p className="muted small">La sesión se recuerda en este dispositivo durante 6 meses.</p>
      </form>
    </Landing>
  );
}
