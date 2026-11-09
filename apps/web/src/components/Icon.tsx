/**
 * Iconos de la app, dibujados a mano para este uso:
 *  - pencil: editar la fila (acción repetida en cada fila, donde un texto ocuparía demasiado),
 *  - alert: dato de cotización antiguo (sin conexión), junto al precio afectado,
 *  - refresh, bell, gear, plus: botones de la cabecera en el móvil, donde no cabe el texto
 *    (en el escritorio esos botones siguen llevando texto, que es más claro).
 */
const PATHS = {
  pencil: 'M3 13.5V16h2.5l7.4-7.4-2.5-2.5L3 13.5Zm11.8-6.8a.7.7 0 0 0 0-1l-1.5-1.5a.7.7 0 0 0-1 0l-1.2 1.2 2.5 2.5 1.2-1.2Z',
  alert: 'M9 2.5 1.5 15.5h15L9 2.5Zm0 4.2v4.6m0 1.9v.1',
  refresh: 'M15 9a6 6 0 1 1-1.76-4.24M13.4 1.9v3h-3',
  bell: 'M4.5 12.5V8.2a4.5 4.5 0 0 1 9 0v4.3l1.5 1.5H3l1.5-1.5ZM7.3 15.6a1.8 1.8 0 0 0 3.4 0',
  gear: 'M14.35 7.35L16.19 7.76L16.19 10.24L14.35 10.65L13.95 11.61L14.96 13.21L13.21 14.96L11.61 13.95L10.65 14.35L10.24 16.19L7.76 16.19L7.35 14.35L6.39 13.95L4.79 14.96L3.04 13.21L4.05 11.61L3.65 10.65L1.81 10.24L1.81 7.76L3.65 7.35L4.05 6.39L3.04 4.79L4.79 3.04L6.39 4.05L7.35 3.65L7.76 1.81L10.24 1.81L10.65 3.65L11.61 4.05L13.21 3.04L14.96 4.79L13.95 6.39ZM9 6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z',
  plus: 'M9 3.5v11M3.5 9h11',
};

export function Icon({ name, label, size = 16 }: { name: keyof typeof PATHS; label?: string; size?: number }) {
  const filled = name === 'pencil';
  return (
    <svg
      className={`icon icon--${name}`}
      width={size}
      height={size}
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
