import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { quoteSources } from './QuoteSources.tsx';
import type { Quote } from '@watchlist/shared';

/**
 * Estado de las cotizaciones en la cabecera: un icono de actualizar que no se mueve con cada refresco.
 * Al pulsarlo fuerza la actualización; al pasar el ratón (o con el foco) cuenta cuándo se actualizó,
 * de dónde vienen los precios y qué valores no se han podido cargar.
 */
export function SyncStatus({
  label,
  tone,
  hint,
  quotes,
  missing,
  extra,
  spinning,
  disabled,
  onRefresh,
}: {
  /** «Actualizado hace 3 s», «Sin conexión…»: solo se ve en el panel, así la cabecera no baila. */
  label: string;
  tone: 'ok' | 'stale';
  hint?: string;
  quotes: (Quote | null | undefined)[];
  /** Valores sin precio al día (no cargado o dato guardado). */
  missing: string[];
  extra?: ReactNode;
  /** Solo con la actualización forzada: el refresco automático de cada pocos segundos no lo mueve. */
  spinning: boolean;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const sources = quoteSources(quotes);
  const summary = `${label}${missing.length ? ` · ${missing.length} sin precio` : ''}`;
  return (
    <div className={`sync sync--${tone}`} data-tour="refresh">
      <button
        type="button"
        className="btn btn--ghost sync__btn"
        onClick={onRefresh}
        disabled={disabled}
        aria-label={`Actualizar cotizaciones. ${summary}`}
        aria-describedby="sync-panel"
      >
        <span className={`btn__icon${spinning ? ' btn__icon--spin' : ''}`}>
          <Icon name="refresh" size={20} />
        </span>
        {(tone !== 'ok' || missing.length > 0) && <span className="sync__dot" aria-hidden="true" />}
      </button>
      <div id="sync-panel" className="sync__panel" role="tooltip">
        <p className="sync__state">{label}</p>
        {hint && <p className="sync__hint">{hint}</p>}
        {sources.length > 0 && (
          <>
            <p className="sync__title">Precios de</p>
            <ul className="sync__list">
              {sources.map((s) => (
                <li key={s.source}>
                  <span className="quote-source" aria-hidden="true">{s.mark}</span>
                  <span>
                    {s.source}
                    {s.fallback > 0 && <small className="sync__via"> · {s.fallback === s.n ? 'vía de reserva' : `${s.fallback} por vía de reserva`}</small>}
                  </span>
                  <span className="num">{s.n}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {missing.length > 0 && (
          <>
            <p className="sync__title sync__title--warn">Sin precio al día ({missing.length})</p>
            <ul className="sync__list sync__list--missing">
              {missing.slice(0, 8).map((n) => <li key={n}>{n}</li>)}
              {missing.length > 8 && <li className="muted">y {missing.length - 8} más</li>}
            </ul>
          </>
        )}
        {sources.some((s) => s.fallback > 0) && (
          <p className="sync__hint">Vía de reserva: la consulta habitual de esa fuente está limitada y los precios llegan por otra más lenta, sin estado del mercado. Siguen siendo precios al día.</p>
        )}
        {extra}
        <p className="sync__foot">Pulsa para actualizar ahora.</p>
      </div>
    </div>
  );
}
