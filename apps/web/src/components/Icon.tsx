/**
 * Los dos únicos iconos de la app, dibujados a mano para este uso:
 *  - pencil: editar la fila (acción repetida en cada fila, donde un texto ocuparía demasiado),
 *  - alert: dato de cotización antiguo (sin conexión), junto al precio afectado.
 * El resto de acciones llevan texto, que es más claro para quien no conoce la app.
 */
const PATHS = {
  pencil: 'M3 13.5V16h2.5l7.4-7.4-2.5-2.5L3 13.5Zm11.8-6.8a.7.7 0 0 0 0-1l-1.5-1.5a.7.7 0 0 0-1 0l-1.2 1.2 2.5 2.5 1.2-1.2Z',
  alert: 'M9 2.5 1.5 15.5h15L9 2.5Zm0 4.2v4.6m0 1.9v.1',
};

export function Icon({ name, label }: { name: keyof typeof PATHS; label?: string }) {
  const filled = name === 'pencil';
  return (
    <svg
      className={`icon icon--${name}`}
      width="16"
      height="16"
      viewBox="0 0 18 18"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path
        d={PATHS[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={filled ? 0 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
