import { DEFAULT_STATUS_NAMES, displayTicker, tradingViewSymbol, type WatchlistRow } from '@/shared';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { useSettings } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { pct, price } from '../../lib/format.ts';
import { tabListKeys } from '../../lib/tabs.ts';
import { watchlistLines } from './chartLines.ts';
import { CandleChart } from './LazyCandleChart.tsx';
import { PriceMapLarge } from './PriceMapLarge.tsx';
import { QuoteSheet } from './QuoteSheet.tsx';

type View = 'mapa' | 'velas';
const VIEW_KEY = 'watchlist.detalle.vista';
const VIEWS: [View, string][] = [['mapa', 'Mapa de precios'], ['velas', 'Gráfica']];

interface Props {
  row: WatchlistRow;
  base: string;
  /** Ancho visible de la tabla, para que el detalle no se salga de la pantalla al deslizarla. */
  width?: number;
  /** Sin él la ficha no se edita (valor abierto desde el buscador, que aún no está en la lista). */
  onEdit?: () => void;
  /** Botones de la cabecera junto a cerrar (p. ej. «Añadir a Vigilar»). */
  actions?: ReactNode;
  onClose: () => void;
  /** Vuelve a colocar el detalle bajo la cabecera, como al abrirlo. */
  onRecenter?: () => void;
  /** Carril con los demás valores de la lista, a la izquierda (solo en escritorio). */
  rail?: ReactNode;
  /** Es el detalle que protagoniza la transición al saltar de un valor a otro. */
  active?: boolean;
}

/**
 * Alto del detalle en escritorio: lo que queda de pantalla bajo la cabecera y la fila abierta, que
 * es donde la deja el scroll automático. Así se ve solo ese valor, sin asomar la fila siguiente.
 */
function useFillScreen(box: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const header = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
      const row = el.closest('tr')?.previousElementSibling?.getBoundingClientRect().height ?? 0;
      el.style.setProperty('--xp-fill', `${Math.round(window.innerHeight - header - row)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [box]);
}

/**
 * Detalle de un valor bajo su fila. A la izquierda, a elegir, el mapa de precios o el gráfico
 * histórico; a la derecha, la ficha con todos sus datos.
 */
export function ValueExpanded({ row, base, width, onEdit, onClose, onRecenter, rail, active, actions }: Props) {
  const settings = useSettings().data;
  const names = settings?.statusNames ?? DEFAULT_STATUS_NAMES;
  /** La ficha de la derecha en edición: todo (lápiz) o el campo pulsado (clic para editar). */
  const [editing, setEditing] = useState<{ field: string; inline: boolean } | null>(null);
  const [chosen, setView] = useState<View>(() => {
    const stored = localStorage.getItem(VIEW_KEY);
    // Las antiguas pestañas de TradingView y del gráfico histórico pasan a ser la gráfica de velas.
    return stored === 'tradingview' || stored === 'grafico' ? 'velas' : (stored as View) || 'mapa';
  });
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useFillScreen(box);
  const { item, quote, metrics } = row;
  // El precio en directo que va pidiendo la gráfica abierta (sin pedirlo aquí): la cabecera dice lo mismo.
  const live = useQuery({ queryKey: ['live', item.symbol], queryFn: () => api.live(item.symbol), enabled: false }).data;
  const shownPrice = live?.price || quote?.price;
  // Los fondos sin cotización en bolsa no están en TradingView: sin enlace para abrirlo allí.
  const tvSymbol = tradingViewSymbol(item.symbol, quote?.quoteType);
  const view = VIEWS.some(([v]) => v === chosen) ? chosen : 'mapa';
  const choose = (v: View) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  return (
    <div ref={box} className={`xp${rail ? ' xp--rail' : ''}${active ? ' xp--active' : ''}`} style={width ? { width } : undefined} role="region" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="sr-only">Detalle de {item.name ?? item.symbol}</h2>
      {rail}
      <div className="xp__main">
      <header className="xp__head">
        {/* En escritorio la fila del valor se oculta al abrirlo: su nombre pasa aquí. */}
        <div className="xp__id" aria-hidden>
          <span className="xp__name" title={item.name ?? item.symbol}>{item.name ?? item.symbol}</span>
          <span className="sub">
            <span className="ticker">{displayTicker(item)}</span>
            {quote?.exchange && <> · {quote.exchange}</>}
            {quote?.currency && <> · {quote.currency}</>}
          </span>
        </div>
        <div className="xp__quote">
          <span className="xp__price num">{price(shownPrice, quote?.currency)}</span>
          {quote?.changePct != null && (
            <span className={`delta ${quote.changePct >= 0 ? 'up' : 'down'}`}>{pct(quote.changePct, 2)} hoy</span>
          )}
        </div>
        <p className="xp__status">
          {metrics.status !== 'unknown' && <span className={`pill pill--${metrics.status}`}>{names[metrics.status]}</span>}
          {item.orderActive && <span className="pill watchlist-order-pill">Con orden</span>}
        </p>
        <div className="xp__tools">
          {actions}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar el detalle" title="Cerrar">
            ×
          </button>
        </div>
      </header>

      <div className="xp__body">
        <section className="xp__panel xp__visual">
          <div className="xp__tabbar">
          <div className="xp__tabs" role="tablist" aria-label="Vista" onKeyDown={tabListKeys}>
            {VIEWS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                id={`${id}-tab-${v}`}
                aria-controls={`${id}-panel`}
                aria-selected={view === v}
                tabIndex={view === v ? 0 : -1}
                className={view === v ? 'on' : ''}
                onClick={() => choose(v)}
              >
                {label}
              </button>
            ))}
          </div>
          {onRecenter && (
            <button type="button" className="icon-btn xp__recenter" onClick={onRecenter} aria-label="Centrar el detalle en pantalla" title="Centrar">
              <Icon name="locate" />
            </button>
          )}
          </div>
          <div className="xp__view" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${view}`}>
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
            <CandleChart key={item.symbol} symbol={item.symbol} name={item.name ?? item.symbol} price={quote?.price} lines={watchlistLines(row)} tvSymbol={tvSymbol} />
          )}
          </div>
        </section>
        <section className="xp__panel xp__data" aria-label="Datos">
          <QuoteSheet
            key={editing ? `edit-${item.id}` : item.id}
            row={row}
            base={base}
            editing={!!editing}
            inline={editing?.inline}
            focus={editing?.field}
            onEditField={onEdit && ((field) => setEditing({ field, inline: true }))}
            onEdit={onEdit && (() => setEditing({ field: 'l0', inline: false }))}
            onDone={() => setEditing(null)}
            onMore={onEdit && (() => {
              setEditing(null);
              onEdit();
            })}
          />
        </section>
      </div>
      </div>
    </div>
  );
}
