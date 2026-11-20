import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, AUTH_CHANGED, SESSION_LOST, api, reloadSession } from '../../api/client.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';
import { AUTH_PATH, Landing } from './Landing.tsx';

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

  if (session.isPending) return <p className="muted center login-loading">Cargando…</p>;
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
    <Landing
      canRegister={registrationEnabled}
      onEnter={(register) => {
        if (register !== registering) { setRegistering(register); setPassword(''); setConfirmation(''); setError(null); }
      }}
    >
      <form className="login__card" onSubmit={submit}>
        <h3 className="login__title">{registering ? 'Crear cuenta' : 'Iniciar sesión'}</h3>
        {!registering && <p className="muted small">Organiza tus listas de seguimiento y tu cartera en una cuenta privada.</p>}
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
          maxLength={200}
          aria-describedby={registering ? 'password-help' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {registering && <>
          <p id="password-help" className="muted small">Al menos 12 caracteres. Puedes usar una frase.</p>
          <label htmlFor="login-confirm">Repetir contraseña</label>
          <input id="login-confirm" name="confirmation" type="password" autoComplete="new-password"
            value={confirmation} onChange={(e) => setConfirmation(e.target.value)} maxLength={200} required />
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
