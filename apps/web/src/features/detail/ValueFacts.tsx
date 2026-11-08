import { DEFAULT_STATUS_NAMES, isMuted, localToday, type WatchlistRow } from '@watchlist/shared';
import type { ReactNode } from 'react';
import { useSettings } from '../../api/hooks.ts';
import { compact, money, num, pct, price, RECOMMENDATION_ES, shortDate } from '../../lib/format.ts';
import { KEY_DATE_LABEL, upcoming } from '../../lib/keyDates.ts';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="facts__group">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}

/** Todos los datos de un valor agrupados: tus compras, objetivos, la compra prevista y la empresa. */
export function ValueFacts({ row, base }: { row: WatchlistRow; base: string }) {
  const { item, quote, targets, metrics } = row;
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const cur = quote?.currency ?? base;
  const keyDates = upcoming(row);
  const company = [
    targets?.trailingPE != null && `PER ${num(targets.trailingPE, 1)}`,
    targets?.dividendYield ? `dividendo ${pct(targets.dividendYield).replace('+', '')}` : null,
    targets?.marketCap != null && `capitalización ${compact(targets.marketCap, cur === 'GBp' ? 'GBP' : cur)}`,
  ].filter(Boolean);

  return (
    <div className="facts">
      <Group title="Tus precios de compra">
        {metrics.levels.length === 0 && (
          <div className="fact">
            <dd className="muted">Todavía no has puesto ninguno.</dd>
          </div>
        )}
        {metrics.levels.map((l, i) => (
          <Fact key={i} label={`Compra ${i + 1}`}>
            <span className="num strong">{price(l.price)}</span>{' '}
            <span className={`pill pill--${l.status}`}>{pct(l.distancePct)}</span>
            {l.status !== 'unknown' && <span className="fact__sub">{names[l.status]}</span>}
          </Fact>
        ))}
      </Group>

      <Group title="Objetivos">
        <Fact label={item.brokerName ? `Bróker (${item.brokerName})` : 'Bróker'}>
          {item.brokerTarget ? (
            <>
              <span className="num">{price(item.brokerTarget)}</span> <span className="muted">{pct(metrics.upsideBrokerPct)}</span>
            </>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Consenso de analistas">
          {targets?.mean ? (
            <>
              <span className="num">{price(targets.mean)}</span> <span className="muted">{pct(metrics.upsideConsensusPct)}</span>
              <span className="fact__sub">
                {targets.analysts ?? '?'} analistas
                {targets.recommendation && targets.recommendation !== 'none' && ` · ${RECOMMENDATION_ES[targets.recommendation] ?? targets.recommendation}`}
              </span>
              {targets.low != null && targets.high != null && (
                <span className="fact__sub">
                  De {price(targets.low)} a {price(targets.high)}
                </span>
              )}
            </>
          ) : (
            '–'
          )}
        </Fact>
      </Group>

      <Group title="Compra prevista">
        <Fact label="Acciones e importe">
          {metrics.shares != null ? (
            <>
              <span className="num">{num(metrics.shares)}</span> acciones · <span className="num">{money(metrics.netBase, base)}</span>
              {cur !== base && metrics.netNative != null && <span className="fact__sub">{money(metrics.netNative, cur)}</span>}
              <span className="fact__sub">Ahorro frente a comprar hoy: {money(metrics.diffBase, base)}</span>
            </>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Orden en el banco">
          {item.orderActive ? (
            <>
              <span className="num">{item.orderPrice != null ? price(item.orderPrice) : 'Sin precio'}</span>
              {item.orderUntil && (
                <span className="fact__sub">
                  Hasta el {shortDate(item.orderUntil)}
                  {metrics.orderExpired ? ' (caducada)' : metrics.orderDaysLeft != null ? ` · quedan ${metrics.orderDaysLeft} d` : ''}
                </span>
              )}
            </>
          ) : (
            'No'
          )}
        </Fact>
      </Group>

      <Group title="Empresa">
        <Fact label="Rango 52 semanas">
          {quote?.low52 != null && quote.high52 != null ? (
            <span className="num">
              {price(quote.low52)} a {price(quote.high52)}
            </span>
          ) : (
            '–'
          )}
        </Fact>
        {(company.length > 0 || keyDates.length > 0) && (
          <Fact label="Datos">
            {company.join(' · ') || '–'}
            {keyDates.map((d) => (
              <span key={d.kind} className="fact__sub">
                {KEY_DATE_LABEL[d.kind]} el {shortDate(d.date)} ({d.days === 0 ? 'hoy' : `en ${d.days} d`})
              </span>
            ))}
          </Fact>
        )}
        <Fact label="Avisos">
          {isMuted(item.mutedUntil, localToday())
            ? item.mutedUntil === 'always'
              ? 'Silenciados'
              : `Silenciados hasta el ${shortDate(item.mutedUntil)}`
            : 'Activados'}
        </Fact>
      </Group>

      {item.notes && (
        <Group title="Notas">
          <p className="facts__notes">{item.notes}</p>
        </Group>
      )}
    </div>
  );
}
