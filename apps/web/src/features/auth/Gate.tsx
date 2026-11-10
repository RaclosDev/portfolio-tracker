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
        {googleEnabled && <a className="btn" href="/api/auth/google">Continuar con Google</a>}
        <p className="muted small">La sesión se recuerda en este dispositivo durante 6 meses.</p>
      </form>
    </main>
  );
}
