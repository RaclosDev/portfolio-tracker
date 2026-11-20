import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { Series } from './indicators.ts';

interface MediaTarget {
  useMediaCoordinateSpace: (cb: (scope: { context: CanvasRenderingContext2D }) => void) => void;
}

/**
 * Relleno entre dos líneas de un indicador (bandas de Bollinger, canal de Donchian, nube de Ichimoku).
 * Las cifras van alineadas con las velas: la posición en la lista es el índice lógico del gráfico.
 * Con dos colores, el tramo cambia de color donde las líneas se cruzan.
 */
export class BandFillPrimitive implements ISeriesPrimitive<Time> {
  private a: Series = [];
  private b: Series = [];
  private up = 'transparent';
  private down = 'transparent';
  private param: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.draw(target as unknown as MediaTarget) };
    this.view = { renderer: () => renderer, zOrder: () => 'bottom' };
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>) { this.param = param; }
  detached() { this.param = null; }
  paneViews() { return [this.view]; }

  set(a: Series, b: Series, up: string, down = up) {
    Object.assign(this, { a, b, up, down });
    this.param?.requestUpdate();
  }

  private draw(target: MediaTarget) {
    const p = this.param;
    if (!p) return;
    const ts = p.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.a.length - 1, Math.ceil(range.to) + 1);
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      let run: [number, number, number][] = [];
      let sign = 0;
      const flush = () => {
        if (run.length > 1) {
          ctx.fillStyle = sign >= 0 ? this.up : this.down;
          ctx.beginPath();
          run.forEach(([x, ya], i) => (i ? ctx.lineTo(x, ya) : ctx.moveTo(x, ya)));
          for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(run[i]![0], run[i]![2]);
          ctx.closePath();
          ctx.fill();
        }
        run = [];
      };
      for (let i = from; i <= to; i++) {
        const va = this.a[i];
        const vb = this.b[i];
        const x = ts.logicalToCoordinate(i as never);
        const ya = va == null ? null : p.series.priceToCoordinate(va);
        const yb = vb == null ? null : p.series.priceToCoordinate(vb);
        if (x == null || ya == null || yb == null) { flush(); continue; }
        const s = va! >= vb! ? 1 : -1;
        const last = run.at(-1);
        if (last && s !== sign) {
          // Punto de cruce: cierra el tramo de un color y empieza el del otro.
          const d0 = last[1] - last[2];
          const t = d0 / (d0 - (ya - yb));
          const cx = last[0] + t * (x - last[0]);
          const cy = last[1] + t * (ya - last[1]);
          run.push([cx, cy, cy]);
          flush();
          run.push([cx, cy, cy]);
        }
        sign = s;
        run.push([x, ya, yb]);
      }
      flush();
    });
  }
}
