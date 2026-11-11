import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, AUTH_CHANGED, SESSION_LOST, api, reloadSession } from '../../api/client.ts';

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
          <h1>Watchlist</h1>
          <p className="error-box">No se puede conectar con el servidor. Si acaba de arrancar, espera unos segundos.</p>
          <button type="button" className="btn btn--primary" onClick={() => void session.refetch()}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }
  if (session.data.authRequired && !session.data.authenticated) {
    return (
      <Login
        googleEnabled={session.data.googleEnabled}
        registrationEnabled={session.data.registrationEnabled}
        onDone={reloadSession}
      />
    );
  }
  return <>
    {new URLSearchParams(window.location.search).has('login') && <p className="error-box" role="alert">
      No se pudo vincular Google. Usa la cuenta de Google con el mismo correo que tu cuenta de Watchlist.
      <button type="button" className="btn" onClick={() => window.location.replace('/')}>Cerrar</button>
    </p>}
    {children}
  </>;
}

function Login({ googleEnabled, registrationEnabled, onDone }: {
  googleEnabled: boolean; registrationEnabled: boolean; onDone: () => void;
}) {
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(() => {
    const status = new URLSearchParams(window.location.search).get('login');
    if (status === 'google-account-exists') return 'Ya existe una cuenta con ese correo. Entra con tu contraseña y vincula Google desde Ajustes.';
    return status === 'google-error' ? 'No se pudo entrar con Google. Vuelve a intentarlo.' : null;
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('login')) {
      url.searchParams.delete('login');
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

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
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <h1>Watchlist</h1>
        </div>
        <h2 className="login__title">{registering ? 'Crear cuenta' : 'Iniciar sesión'}</h2>
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
        {googleEnabled && (
          <a className="login__google" href="/api/auth/google">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
              <path fill="#FBBC05" d="M10.53 28.59C10.05 27.14 9.77 25.6 9.77 24s.28-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19Z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
            </svg>
            <span>Continuar con Google</span>
          </a>
        )}
        {registrationEnabled && <p className="small login__switch">
          {registering ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
          <button type="button" className="login__link" disabled={busy} onClick={() => {
            setRegistering(!registering); setPassword(''); setConfirmation(''); setError(null);
          }}>{registering ? 'Inicia sesión' : 'Crear cuenta'}</button>
        </p>}
        <p className="muted small">La sesión se recuerda en este dispositivo durante 6 meses.</p>
        <nav className="small login__legal" aria-label="Información de la aplicación">
          <a href="/privacidad.html">Privacidad</a><a href="/condiciones.html">Condiciones de uso</a>
        </nav>
      </form>
    </main>
  );
}
