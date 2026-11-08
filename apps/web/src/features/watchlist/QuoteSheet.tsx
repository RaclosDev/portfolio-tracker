import { DEFAULT_STATUS_NAMES, isMuted, localToday, type WatchlistRow } from '@watchlist/shared';
import type { ReactNode } from 'react';
import { useSettings } from '../../api/hooks.ts';
import { compact, money, num, pct, price, RECOMMENDATION_ES, shortDate } from '../../lib/format.ts';
import { KEY_DATE_LABEL, upcoming } from '../../lib/keyDates.ts';

function Row({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="sheet__row">
      <dt>{label}</dt>
      <dd>
        {children}
        {sub && <span className="sheet__sub">{sub}</span>}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sheet__section">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}

const Upside = ({ v }: { v: number | null }) =>
  v == null ? null : <span className={`delta ${v >= 0 ? 'up' : 'down'}`}>{pct(v, 1)}</span>;

/**
 * Ficha de datos del valor, al estilo de una hoja de cotización: etiqueta a la izquierda,
 * cifra alineada a la derecha. Solo aparece lo que existe (sin filas vacías con guiones).
 */
export function QuoteSheet({ row, base }: { row: WatchlistRow; base: string }) {
  const { item, quote, targets, metrics } = row;
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const cur = quote?.currency ?? base;
  const keyDates = upcoming(row);
  const muted = isMuted(item.mutedUntil, localToday());

  return (
    <div className="sheet">
      <Section title="Tus precios de compra">
        {metrics.levels.length === 0 && <Row label="Niveles">Ninguno todavía</Row>}
        {metrics.levels.map((l, i) => (
          <Row key={i} label={`Compra ${i + 1}`} sub={l.status !== 'unknown' ? names[l.status] : undefined}>
            <span className="num">{price(l.price)}</span> <span className={`pill pill--${l.status}`}>{pct(l.distancePct)}</span>
          </Row>
        ))}
        {item.orderActive && (
          <Row
            label="Orden en el banco"
            sub={
              item.orderUntil
                ? `Hasta el ${shortDate(item.orderUntil)}${metrics.orderExpired ? ' · caducada' : metrics.orderDaysLeft != null ? ` · ${metrics.orderDaysLeft} d` : ''}`
                : undefined
            }
          >
            <span className="num">{item.orderPrice != null ? price(item.orderPrice) : 'Sin precio'}</span>
          </Row>
        )}
      </Section>

      <Section title="Objetivos">
        <Row label={item.brokerName ? `Bróker · ${item.brokerName}` : 'Bróker'}>
          {item.brokerTarget ? (
            <>
              <span className="num">{price(item.brokerTarget)}</span> <Upside v={metrics.upsideBrokerPct} />
            </>
          ) : (
            <span className="muted">Sin objetivo</span>
          )}
        </Row>
        <Row
          label="Consenso"
          sub={
            targets?.mean
              ? [
                  targets.analysts != null && `${targets.analysts} analistas`,
                  targets.recommendation && targets.recommendation !== 'none' && (RECOMMENDATION_ES[targets.recommendation] ?? targets.recommendation),
                  targets.low != null && targets.high != null && `${price(targets.low)} – ${price(targets.high)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
        >
          {targets?.mean ? (
            <>
              <span className="num">{price(targets.mean)}</span> <Upside v={metrics.upsideConsensusPct} />
            </>
          ) : (
            <span className="muted">Sin datos</span>
          )}
        </Row>
      </Section>

      <Section title="Compra prevista">
        <Row label="Acciones" sub={metrics.sharesCalc != null && item.sharesOverride == null ? `calculadas ${num(metrics.sharesCalc, 1)}` : undefined}>
          <span className="num">{metrics.shares != null ? num(metrics.shares) : '–'}</span>
        </Row>
        <Row label="Importe" sub={cur !== base && metrics.netNative != null ? money(metrics.netNative, cur) : undefined}>
          <span className="num">{money(metrics.netBase, base)}</span>
        </Row>
        <Row label="Ahorro frente a hoy">
          <span className="num">{money(metrics.diffBase, base)}</span>
        </Row>
      </Section>

      <Section title="Empresa">
        {quote?.low52 != null && quote.high52 != null && (
          <Row label="Rango del año">
            <span className="num">
              {price(quote.low52)} – {price(quote.high52)}
            </span>
          </Row>
        )}
        {targets?.trailingPE != null && (
          <Row label="PER">
            <span className="num">{num(targets.trailingPE, 1)}</span>
          </Row>
        )}
        {!!targets?.dividendYield && (
          <Row label="Rentabilidad por dividendo">
            <span className="num">{pct(targets.dividendYield).replace('+', '')}</span>
          </Row>
        )}
        {targets?.marketCap != null && (
          <Row label="Capitalización">
            <span className="num">{compact(targets.marketCap, cur === 'GBp' ? 'GBP' : cur)}</span>
          </Row>
        )}
        {keyDates.map((d) => (
          <Row key={d.kind} label={KEY_DATE_LABEL[d.kind]}>
            <span className="num">{shortDate(d.date)}</span> <span className="muted">{d.days === 0 ? 'hoy' : `en ${d.days} d`}</span>
          </Row>
        ))}
        <Row label="Avisos">
          {muted ? (item.mutedUntil === 'always' ? 'Silenciados' : `Silenciados hasta el ${shortDate(item.mutedUntil)}`) : 'Activados'}
        </Row>
      </Section>

      {item.notes && (
        <section className="sheet__section sheet__notes">
          <h4>Notas</h4>
          <p>{item.notes}</p>
        </section>
      )}
    </div>
  );
}
