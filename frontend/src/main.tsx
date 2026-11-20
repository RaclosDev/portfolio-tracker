import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FeedbackHost } from './components/feedback.tsx';
import { Gate } from './features/auth/Gate.tsx';
import { registerServiceWorker } from './lib/push.ts';
import '@fontsource-variable/inter';
import '@fontsource/permanent-marker'; // solo se descargan si se elige la skin «Papel»
import '@fontsource/anton';
import './styles.css';
import './skin-paper.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
});

registerServiceWorker();

// Tras una publicación los trozos de la versión anterior dejan de existir: si uno no carga, se
// recarga para coger la nueva (una vez por minuto como mucho, para no entrar en bucle).
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('watchlist.chunkReload') ?? 0);
  if (Date.now() - last < 60_000) return;
  sessionStorage.setItem('watchlist.chunkReload', String(Date.now()));
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Gate>
          <App />
        </Gate>
        <FeedbackHost />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
