import { DEFAULT_STATUS_NAMES, type WatchlistRow } from '@watchlist/shared';
import { useState } from 'react';
import { useSettings } from '../../api/hooks.ts';
import { pct, price } from '../../lib/format.ts';
import { HistoryView } from './HistoryView.tsx';
import { PriceMapLarge } from './PriceMapLarge.tsx';
import { QuoteSheet } from './QuoteSheet.tsx';

type View = 'mapa' | 'grafico';
const VIEW_KEY = 'watchlist.detalle.vista';

interface Props {
  row: WatchlistRow;
  base: string;
  /** Ancho visible de la tabla, para que el detalle no se salga de la pantalla al deslizarla. */
  width?: number;
  onEdit: () => void;
  onClose: () => void;
}

/**
 * Detalle de un valor bajo su fila. A la izquierda, a elegir, el mapa de precios o el gráfico
 * histórico; a la derecha, la ficha con todos sus datos.
 */
export function ValueExpanded({ row, base, width, onEdit, onClose }: Props) {
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) as View) || 'mapa');
  const { item, quote, metrics } = row;
  const idx = metrics.levels.findIndex((l) => metrics.status === 'reached'
    ? l.status === 'reached'
    : l.distancePct != null && l.distancePct === metrics.nearestDistancePct);
  const lvl = metrics.levels[idx];
  const choose = (v: View) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  let headline = metrics.levels.length ? 'Distancia pendiente de cotización' : 'Sin niveles de compra';
  if (lvl && metrics.nearestDistancePct != null) {
    const distance = metrics.status === 'reached'
      ? 'precio en zona'
      : `falta un ${pct(Math.abs(metrics.nearestDistancePct)).replace('+', '')}`;
    headline = `Nivel ${idx + 1} · ${price(lvl.price, quote?.currency)} · ${distance}`;
  }

  return (
    <div className="xp" style={width ? { width } : undefined} role="region" aria-label={`Detalle de ${item.name ?? item.symbol}`}>
      <header className="xp__head">
        <div className="xp__quote">
          <span className="xp__price num">{price(quote?.price, quote?.currency)}</span>
          {quote?.changePct != null && (
            <span className={`delta ${quote.changePct >= 0 ? 'up' : 'down'}`}>{pct(quote.changePct, 2)} hoy</span>
          )}
        </div>
        <p className="xp__status">
          {metrics.status !== 'unknown' && <span className={`pill pill--${metrics.status}`}>{names[metrics.status]}</span>}
          {item.orderActive && <span className="pill watchlist-order-pill">Con orden</span>}
          <span>{headline}</span>
        </p>
        <div className="xp__tools">
          <button type="button" className="btn btn--small" onClick={onEdit}>
            Editar
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar el detalle" title="Cerrar">
            ×
          </button>
        </div>
      </header>

      <div className="xp__body">
        <section className="xp__panel xp__visual">
          <div className="xp__tabs" role="tablist" aria-label="Vista">
            <button type="button" role="tab" aria-selected={view === 'mapa'} className={view === 'mapa' ? 'on' : ''} onClick={() => choose('mapa')}>
              Mapa de precios
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'grafico'}
              className={view === 'grafico' ? 'on' : ''}
              onClick={() => choose('grafico')}
            >
              Gráfico histórico
            </button>
          </div>
          {view === 'mapa' ? (
            <>
              <PriceMapLarge row={row} />
              <ul className="xp__legend" aria-label="Leyenda">
                <li><i className="lg lg-price" /> Precio actual</li>
                <li><i className="lg lg-zone" /> Zona de compra</li>
                <li><i className="lg lg-level" /> Tus compras</li>
                <li><i className="lg lg-track" /> Rango del año</li>
                {item.brokerTarget != null && <li><i className="lg lg-broker" /> Bróker</li>}
                {row.targets?.mean != null && <li><i className="lg lg-consensus" /> Consenso</li>}
              </ul>
            </>
          ) : (
            <HistoryView row={row} />
          )}
        </section>
        <section className="xp__panel xp__data" aria-label="Datos">
          <QuoteSheet row={row} base={base} />
        </section>
      </div>
    </div>
  );
}
