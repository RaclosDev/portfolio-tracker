import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Si una parte de la interfaz falla al pintarse, en lugar de dejar la ventana en blanco
 * muestra qué ha pasado y un botón para recargar. Los datos no se ven afectados.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Fallo de la interfaz:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1>Algo ha fallado al mostrar la pantalla</h1>
        <p>
          Tus datos están a salvo: este error solo afecta a lo que se ve. Recarga para seguir. Si vuelve a pasar,
          envía a quien te mantiene la app el texto de abajo.
        </p>
        <div className="row-actions">
          <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
            Recargar
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void navigator.clipboard?.writeText(`${error.name}: ${error.message}\n${error.stack ?? ''}`)}
          >
            Copiar el error
          </button>
        </div>
        <pre className="crash__detail">
          {error.name}: {error.message}
        </pre>
      </main>
    );
  }
}
