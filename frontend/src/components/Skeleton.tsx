/**
 * Marcadores de carga con la forma de lo que va a salir (tabla, tarjetas, gráfico), en lugar de un «Cargando…».
 * Llevan `role="status"` con el texto para lectores de pantalla; el brillo se quita con «reducir movimiento».
 */

/** Barra gris suelta; `w` en % o cualquier medida CSS. */
export function SkeletonBar({ w = '100%', h = 12 }: { w?: string | number; h?: number }) {
  return <span className="skel" style={{ width: typeof w === 'number' ? `${w}px` : w, height: h }} aria-hidden="true" />;
}

/** Tabla de valores: nombre con subtítulo y unas cuantas cifras por fila. */
export function TableSkeleton({ rows = 8, cols = 6, label = 'Cargando…' }: { rows?: number; cols?: number; label?: string }) {
  // Anchos variados para que no parezca una rejilla; fijos por fila para que no bailen entre renders.
  const widths = ['70%', '55%', '82%', '60%', '75%', '50%', '66%', '78%'];
  const grid = `minmax(160px, 2.2fr) repeat(${cols - 1}, minmax(0, 1fr))`;
  return (
    <div className="skel-table" role="status" aria-label={label}>
      <div className="skel-table__row skel-table__head" style={{ gridTemplateColumns: grid }}>
        {Array.from({ length: cols }, (_, c) => (
          <span key={c} className={c ? 'skel-table__cell' : undefined}><SkeletonBar w={c ? 48 : 56} h={9} /></span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="skel-table__row" style={{ gridTemplateColumns: grid }}>
          <span className="skel-table__name">
            <SkeletonBar w={widths[r % widths.length]} h={13} />
            <SkeletonBar w="35%" h={9} />
          </span>
          {Array.from({ length: cols - 1 }, (_, c) => (
            <span key={c} className="skel-table__cell">
              <SkeletonBar w={widths[(r + c + 3) % widths.length]} h={12} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Hueco de un gráfico: la caja con unas líneas de rejilla. */
export function ChartSkeleton({ height = 240, label = 'Cargando el gráfico…' }: { height?: number; label?: string }) {
  return (
    <div className="skel skel-chart" style={{ height }} role="status" aria-label={label}>
      <span className="skel-chart__grid" aria-hidden="true" />
    </div>
  );
}

/** Página de la cartera mientras carga: pestañas, filtros y tabla de posiciones, como la vista real. */
export function PortfolioSkeleton() {
  return (
    <div className="skel-page" role="status" aria-label="Cargando la cartera…">
      <div className="skel-toolbar" aria-hidden="true">
        <span className="skel-seg">
          {[58, 78, 70, 72, 58, 44].map((w, i) => <SkeletonBar key={i} w={w} h={14} />)}
        </span>
        <span className="spacer" />
        <SkeletonBar w={136} h={34} />
      </div>
      <div className="skel-toolbar" aria-hidden="true">
        <span className="skel-seg">{[40, 62, 30, 46].map((w, i) => <SkeletonBar key={i} w={w} h={12} />)}</span>
        <span className="skel-seg">{[40, 30, 30].map((w, i) => <SkeletonBar key={i} w={w} h={12} />)}</span>
      </div>
      <TableSkeleton rows={9} cols={7} label="Cargando posiciones…" />
    </div>
  );
}

/** Franja de resumen de la lista (zona de compra, muy cerca, órdenes, resultados) mientras llegan los precios. */
export function HighlightsSkeleton() {
  const groups = [['Muy cerca', 3], ['Órdenes', 2], ['Resultados', 2]] as const;
  return (
    <section className="hl-strip hl-strip--skel" role="status" aria-label="Cargando el resumen…">
      {groups.map(([label, n]) => (
        <div key={label} className="hl-group">
          <span className="hl-group__label">{label}</span>
          <span className="hl-items">
            {Array.from({ length: n }, (_, i) => <SkeletonBar key={i} w={[84, 64, 96][i]} h={12} />)}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * La app entera mientras llegan la sesión y la primera pantalla: la cabecera de verdad y, debajo, la forma de la
 * última página abierta. Un logo con una barra en el centro hace que la espera parezca más larga.
 */
export function AppSkeleton({ page }: { page: 'lista' | 'cartera' }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <h1>Portfolio Tracker</h1>
        </div>
        <span className="skel-seg" aria-hidden="true">
          {[96, 72, 64].map((w, i) => <SkeletonBar key={i} w={w} h={14} />)}
        </span>
      </header>
      <main className="content">
        {page === 'cartera' ? <PortfolioSkeleton /> : (
          <>
            <HighlightsSkeleton />
            <TableSkeleton rows={8} cols={6} label="Cargando cotizaciones…" />
          </>
        )}
      </main>
    </div>
  );
}
