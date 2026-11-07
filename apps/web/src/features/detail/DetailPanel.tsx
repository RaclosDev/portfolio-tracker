import { HISTORY_RANGES, isMuted, localToday, type HistoryRange, type WatchlistRow } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { money, num, pct, price, RECOMMENDATION_ES, shortDate } from '../../lib/format.ts';
import { HistoryChart, type RefLine } from './HistoryChart.tsx';

const RANGE_KEY = 'watchlist.ficha.periodo';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Ficha de un valor: gráfico histórico con tus niveles y objetivos, y todos sus datos. */
export function DetailPanel({ row, base, onEdit, onClose }: { row: WatchlistRow; base: string; onEdit: () => void; onClose: () => void }) {
  const { item, quote, targets, metrics } = row;
  const [range, setRange] = useState<HistoryRange>(() => (localStorage.getItem(RANGE_KEY) as HistoryRange) || '1y');
  const history = useQuery({
    queryKey: ['history', item.symbol, range],
    queryFn: () => api.history(item.symbol, range),
    staleTime: 10 * 60_000,
  });

  const refs: RefLine[] = [
    ...metrics.levels.map((l, i) => ({ label: `Compra ${i + 1}`, value: l.price, kind: l.status })),
    ...(item.orderActive && item.orderPrice ? [{ label: 'Orden', value: item.orderPrice, kind: 'order' as const }] : []),
    ...(item.brokerTarget ? [{ label: item.brokerName ?? 'Bróker', value: item.brokerTarget, kind: 'broker' as const }] : []),
    ...(targets?.mean ? [{ label: 'Consenso', value: targets.mean, kind: 'consensus' as const }] : []),
  ];
  const name = item.name ?? quote?.name ?? item.symbol;
  const cur = quote?.currency ?? base;

  return (
    <Dialog
      title={name}
      onClose={onClose}
      className="dialog--drawer"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="btn btn--primary" onClick={onEdit}>
            Editar
          </button>
        </>
      }
    >
      <div className="detail__head">
        <div>
          <span className="ticker">{item.symbol}</span>
          {quote?.exchange && <span className="muted"> · {quote.exchange}</span>}
          {quote?.currency && <span className="muted"> · {quote.currency}</span>}
        </div>
        <div className="detail__price">
          <span className="num strong">{price(quote?.price)}</span>{' '}
          {quote?.changePct != null && (
            <span className={`delta ${quote.changePct >= 0 ? 'up' : 'down'}`}>{pct(quote.changePct, 2)} hoy</span>
          )}
        </div>
      </div>

      <div className="segmented detail__ranges" role="group" aria-label="Periodo del gráfico">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={range === r.id ? 'on' : ''}
            aria-pressed={range === r.id}
            onClick={() => {
              setRange(r.id);
              localStorage.setItem(RANGE_KEY, r.id);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {history.isPending && <p className="muted chart-empty">Cargando el histórico…</p>}
      {history.isError && <p className="error-box">No se pudo cargar el histórico. Prueba otro periodo o vuelve a abrir la ficha.</p>}
      {history.data && (
        <>
          <HistoryChart points={history.data.points} refs={refs} range={range} />
          {history.data.stale && <p className="muted small">Sin conexión: se muestra el último histórico guardado.</p>}
        </>
      )}

      <dl className="facts">
        <Fact label="Rango 52 semanas">
          {quote?.low52 != null && quote.high52 != null ? `${price(quote.low52)} a ${price(quote.high52)}` : '–'}
        </Fact>
        {metrics.levels.map((l, i) => (
          <Fact key={i} label={`Compra ${i + 1}`}>
            {price(l.price)} <span className={`pill pill--${l.status}`}>{pct(l.distancePct)}</span>
          </Fact>
        ))}
        <Fact label="Objetivo del bróker">
          {item.brokerTarget ? (
            <>
              {price(item.brokerTarget)} <span className="muted">({pct(metrics.upsideBrokerPct)}{item.brokerName ? `, ${item.brokerName}` : ''})</span>
            </>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Consenso de analistas">
          {targets?.mean ? (
            <>
              {price(targets.mean)} <span className="muted">({pct(metrics.upsideConsensusPct)})</span>
              <span className="fact__sub">
                {targets.analysts ?? '?'} analistas
                {targets.recommendation && targets.recommendation !== 'none' && ` · ${RECOMMENDATION_ES[targets.recommendation] ?? targets.recommendation}`}
                {targets.low != null && targets.high != null && ` · de ${price(targets.low)} a ${price(targets.high)}`}
              </span>
            </>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Compra prevista">
          {metrics.shares != null ? (
            <>
              {num(metrics.shares)} acciones · {money(metrics.netBase, base)}
              {cur !== base && metrics.netNative != null && <span className="muted"> ({money(metrics.netNative, cur)})</span>}
              <span className="fact__sub">Ahorro frente a comprar hoy: {money(metrics.diffBase, base)}</span>
            </>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Orden en el banco">
          {item.orderActive ? (
            <>
              {item.orderPrice != null ? price(item.orderPrice) : 'Sin precio'}
              {item.orderUntil && (
                <span className="muted">
                  {' '}
                  hasta el {shortDate(item.orderUntil)}
                  {metrics.orderExpired ? ' (caducada)' : metrics.orderDaysLeft != null ? ` (${metrics.orderDaysLeft} d)` : ''}
                </span>
              )}
            </>
          ) : (
            'No'
          )}
        </Fact>
        <Fact label="Avisos">
          {isMuted(item.mutedUntil, localToday())
            ? item.mutedUntil === 'always'
              ? 'Silenciados'
              : `Silenciados hasta el ${shortDate(item.mutedUntil)}`
            : 'Activados'}
        </Fact>
        {item.notes && <Fact label="Notas">{item.notes}</Fact>}
      </dl>
    </Dialog>
  );
}
