import { DEFAULT_STATUS_NAMES, type WatchlistRow } from '@watchlist/shared';
import { useSettings } from '../../api/hooks.ts';
import { pct, price } from '../../lib/format.ts';
import { ValueFacts } from '../detail/ValueFacts.tsx';
import { PriceMapLarge } from './PriceMapLarge.tsx';

interface Props {
  row: WatchlistRow;
  base: string;
  onChart: () => void;
  onEdit: () => void;
  onClose: () => void;
}

/** Vista ampliada de un valor, desplegada bajo su fila: mapa de precios grande y todos los datos. */
export function ValueExpanded({ row, base, onChart, onEdit, onClose }: Props) {
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const { item, quote, metrics } = row;
  const nearest = metrics.levels.findIndex((l) => l.distancePct === metrics.nearestDistancePct);
  const lvl = metrics.levels[nearest];

  let headline: string;
  if (metrics.status === 'reached') headline = 'Ya está en tu zona de compra';
  else if (lvl && metrics.nearestDistancePct != null)
    headline = `Le falta caer un ${pct(Math.abs(metrics.nearestDistancePct)).replace('+', '')} hasta tu compra ${nearest + 1}`;
  else headline = 'Sin precios de compra';

  return (
    <div className="xp" role="region" aria-label={`Detalle de ${item.name ?? item.symbol}`}>
      <div className="xp__head">
        <div className="xp__price">
          <span className="num">{price(quote?.price)}</span>
          {quote?.changePct != null && (
            <span className={`delta ${quote.changePct >= 0 ? 'up' : 'down'}`}>{pct(quote.changePct, 2)} hoy</span>
          )}
        </div>
        <p className="xp__headline">
          {metrics.status !== 'unknown' && <span className={`pill pill--${metrics.status}`}>{names[metrics.status]}</span>} {headline}
        </p>
        <div className="xp__actions">
          <button type="button" className="btn btn--small" onClick={onChart}>
            Gráfico histórico
          </button>
          <button type="button" className="btn btn--small" onClick={onEdit}>
            Editar
          </button>
          <button type="button" className="btn btn--small btn--ghost" onClick={onClose} aria-label="Cerrar el detalle">
            Cerrar
          </button>
        </div>
      </div>
      <PriceMapLarge row={row} />
      <ValueFacts row={row} base={base} />
    </div>
  );
}
