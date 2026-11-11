import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, SESSION_LOST, api } from '../../api/client.ts';

/** Muestra la app solo con la sesión iniciada; si no, la pantalla de entrada. */
export function Gate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity, retry: 2 });

  useEffect(() => {
    const lost = () => {
      qc.setQueryData<Awaited<ReturnType<typeof api.session>>>(['session'], (previous) => previous && {
        ...previous, authenticated: false,
      });
    };
    window.addEventListener(SESSION_LOST, lost);
    return () => window.removeEventListener(SESSION_LOST, lost);
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
        onDone={async () => {
          qc.setQueryData(['session'], { ...session.data, authenticated: true });
          await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
        }}
      />
    );
  }
  return <>{children}</>;
}

function Login({ googleEnabled, onDone }: { googleEnabled: boolean; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('login') === 'google-error'
      ? 'No se pudo entrar con Google. Comprueba que has elegido la cuenta de esta cartera.'
      : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('login') === 'google-error') {
      url.searchParams.delete('login');
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
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
        <label htmlFor="login-email">Correo electrónico</label>
        <input
          id="login-email"
          name="email"
          type="email"
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
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
        <p className="muted small">La sesión se recuerda en este dispositivo durante 6 meses.</p>
      </form>
    </main>
  );
}
