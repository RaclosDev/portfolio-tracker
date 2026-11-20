import { lazy, Suspense, type ComponentProps } from 'react';

// Lightweight Charts pesa ~70 kB comprimido: solo se descarga al abrir el primer gráfico, no al arrancar.
const Chart = lazy(() => import('./CandleChart.tsx').then((m) => ({ default: m.CandleChart })));

export function CandleChart(props: ComponentProps<typeof Chart>) {
  return (
    <Suspense fallback={<div className="xp-candles" aria-busy="true" />}>
      <Chart {...props} />
    </Suspense>
  );
}
