/** Iconos de las barras del gráfico de velas (trazo de 1,5 px en una caja de 18). */
const PATHS = {
  cursor: 'M9 2v14M2 9h14',
  trend: 'M4 14L14 4',
  ray: 'M4 14L16 2',
  extended: 'M1 17L17 1',
  hline: 'M1 9h16',
  hray: 'M5 9h12',
  vline: 'M9 1v16',
  channel: 'M2 11L11 2M7 16L16 7',
  fib: 'M2 3h14M2 7h14M2 11h14M2 15h14',
  rect: 'M3 4h12v10H3z',
  arrow: 'M3 15L15 3M15 3H9M15 3v6',
  text: 'M4 4h10M9 4v11M7 15h4',
  long: 'M3 3h12v6H3zM3 9h12v6H3z',
  short: 'M3 3h12v6H3zM3 9h12v6H3z',
  measure: 'M2 12L12 2l4 4L6 16zM5 9l2 2M8 6l2 2',
  zoomIn: 'M12 12l4 4M5.5 8h5M8 5.5v5',
  zoomOut: 'M12 12l4 4M5.5 8h5',
  magnet: 'M4 2v7a5 5 0 0 0 10 0V2h-3v7a2 2 0 0 1-4 0V2zM4 5h3M11 5h3',
  stay: 'M3 15l1-4 8-8 3 3-8 8zM11 4l3 3',
  lock: 'M4 8h10v8H4zM6 8V6a3 3 0 0 1 6 0v2',
  eye: 'M1 9s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z',
  trash: 'M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11',
  undo: 'M6 4L2 8l4 4M2 8h9a4 4 0 0 1 0 8H8',
  redo: 'M12 4l4 4-4 4M16 8H7a4 4 0 0 0 0 8h3',
  camera: 'M2 6h14v10H2zM6 6l1.5-2h3L12 6',
  fullscreen: 'M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4',
  indicators: 'M2 14l4-5 3 3 6-8',
  caret: 'M6 7l3 3 3-3',
  reset: 'M3.5 6.5A6 6 0 1 1 3 10M3 2.5v4h4',
  copy: 'M6 6h9v10H6zM3 12V2h9',
} as const;
export type IconName = keyof typeof PATHS;

/** Puntos (asas) que se dibujan rellenos encima del trazo. */
const DOTS: Partial<Record<IconName, [number, number][]>> = {
  trend: [[4, 14], [14, 4]],
  ray: [[4, 14], [9, 9]],
  extended: [[6, 12], [12, 6]],
  hline: [[9, 9]],
  hray: [[5, 9]],
  vline: [[9, 9]],
};

export function ChartIcon({ name }: { name: IconName }) {
  const zoom = name === 'zoomIn' || name === 'zoomOut';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'long' && <><rect x="3" y="3" width="12" height="6" fill="var(--up)" opacity=".35" stroke="none" /><rect x="3" y="9" width="12" height="6" fill="var(--down)" opacity=".35" stroke="none" /></>}
      {name === 'short' && <><rect x="3" y="3" width="12" height="6" fill="var(--down)" opacity=".35" stroke="none" /><rect x="3" y="9" width="12" height="6" fill="var(--up)" opacity=".35" stroke="none" /></>}
      {zoom && <circle cx="8" cy="8" r="5" />}
      {name === 'eye' && <circle cx="9" cy="9" r="2.5" />}
      {name === 'camera' && <circle cx="9" cy="11" r="2.5" />}
      <path d={PATHS[name]} />
      {DOTS[name]?.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="currentColor" />)}
    </svg>
  );
}
