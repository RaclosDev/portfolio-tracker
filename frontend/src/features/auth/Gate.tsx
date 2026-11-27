import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { LS_PAGE, seedFirstScreen, seedFromSnapshot } from '../../api/bootstrap.ts';
import { AppSkeleton } from '../../components/Skeleton.tsx';
import { AUTH_CHANGED, DEMO, LS_SNAPSHOT, SESSION_LOST, api } from '../../api/client.ts';
import { AuthPage, ENTERING, reducedMotion } from './AuthPage.tsx';
import { forgetPushAccount, rememberPushAccount } from '../../lib/pushAccount.ts';
import { EnterSplash } from './brand.tsx';
import { Landing } from './Landing.tsx';
import { AUTH_PATHS, safeNext } from './safeNext.ts';

/**
 * Muestra la app solo con la sesión iniciada. Sin sesión, la portada y las páginas de acceso son rutas propias:
 * /login y /registro (cualquier otra ruta enseña la portada).
 */
export function Gate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity, refetchOnWindowFocus: 'always', retry: 2 });
  // Quien ya entró en este navegador ve al instante su última pantalla mientras llegan la sesión y los datos.
  const [snapshotAccount] = useState(() => {
    const known = localStorage.getItem(AUTH_CHANGED);
    return sessionStorage.getItem(ENTERING) === null && seedFromSnapshot(qc, known) ? known : null;
  });
  const [initialAccount, setInitialAccount] = useState<string>();
  const accountId = session.data ? session.data.user?.id ?? 'anonymous' : undefined;
  useEffect(() => {
    // La demo no es una cuenta: si anotase su usuario, las pestañas abiertas de la app de verdad se recargarían.
    if (!accountId || DEMO) return;
    if (accountId === 'anonymous') localStorage.removeItem(LS_SNAPSHOT);
    const pinned = initialAccount ?? (snapshotAccount && accountId !== 'anonymous' ? snapshotAccount : undefined);
    if (pinned && pinned !== accountId) {
      localStorage.setItem(AUTH_CHANGED, accountId);
      window.location.reload();
      return;
    }
    setInitialAccount(accountId);
    if (localStorage.getItem(AUTH_CHANGED) !== accountId) localStorage.setItem(AUTH_CHANGED, accountId);
  }, [accountId, initialAccount, snapshotAccount]);

  // El service worker solo enseña los avisos push de la cuenta con la sesión abierta aquí (ver lib/pushAccount.ts).
  const sessionOpen = session.data?.authenticated === true;
  useEffect(() => {
    if (DEMO || !session.data) return;
    if (sessionOpen && accountId && accountId !== 'anonymous') void rememberPushAccount(accountId);
    else if (!sessionOpen) void forgetPushAccount();
  }, [accountId, sessionOpen, session.data]);

  useEffect(() => {
    const lost = () => {
      qc.setQueryData<Awaited<ReturnType<typeof api.session>>>(['session'], (previous) => previous && {
        ...previous, authenticated: false,
      });
    };
    window.addEventListener(SESSION_LOST, lost);
    const changed = (event: StorageEvent) => { if (!DEMO && event.key === AUTH_CHANGED) window.location.reload(); };
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
    queryFn: () => seedFirstScreen(qc, accountId),
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

  const lastPage = localStorage.getItem(LS_PAGE) === 'cartera' ? 'cartera' : 'lista';
  if (session.isPending && snapshotAccount) return <>{children}</>;
  if (session.isPending) {
    // Quien ya entró otras veces ve la app tomando forma; la pantalla del logo queda para el paso desde la portada.
    const known = (localStorage.getItem(AUTH_CHANGED) ?? 'anonymous') !== 'anonymous';
    if (known && sessionStorage.getItem(ENTERING) === null) return <AppSkeleton page={lastPage} />;
    return <EnterSplash label="Cargando…" instant={sessionStorage.getItem(ENTERING) !== null} />;
  }
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
    const { googleClientId, registrationEnabled } = session.data;
    return (
      <Routes>
        <Route path="/login" element={
          <AuthPage mode="login" googleClientId={googleClientId} registrationEnabled={registrationEnabled} />
        } />
        <Route path="/registro" element={registrationEnabled
          ? <AuthPage mode="register" googleClientId={googleClientId} registrationEnabled />
          : <Navigate to={{ pathname: '/login', search: params.toString() && `?${params}` }} replace />} />
        <Route path="*" element={<Landing canRegister={registrationEnabled} />} />
      </Routes>
    );
  }
  // Con la sesión ya abierta, las páginas de acceso llevan a su destino.
  if (AUTH_PATHS.includes(pathname)) {
    const to = safeNext(params.get('next'));
    return to === '/' ? <Navigate to="/" replace /> : <FullRedirect to={to} />;
  }
  if (!DEMO && firstScreen.isPending && !snapshotAccount) return <AppSkeleton page={lastPage} />;
  return <>{children}</>;
}

/** Fuera de la portada de la app (p. ej. /demo, que decide su modo al cargar) el destino se abre con una carga completa. */
function FullRedirect({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to); }, [to]);
  return null;
}
