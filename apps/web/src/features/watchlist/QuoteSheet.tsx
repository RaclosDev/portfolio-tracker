import { DEFAULT_STATUS_NAMES, isMuted, levelStatus, localToday, type WatchlistRow } from '@watchlist/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useSettings } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { compact, money, num, parseDecimal, pct, price, RECOMMENDATION_ES, shortDate } from '../../lib/format.ts';
import { KEY_DATE_LABEL, upcoming } from '../../lib/keyDates.ts';
import { useSheetDraft } from './useSheetDraft.ts';

/** `edit`: campo que se abre al pulsar la fila (clic para editar). */
function Row({ label, children, sub, edit }: { label: ReactNode; children: ReactNode; sub?: ReactNode; edit?: string }) {
  return (
    <div className="sheet__row" data-edit={edit}>
      <dt>{label}</dt>
      <dd>
        {children}
        {sub && <span className="sheet__sub">{sub}</span>}
      </dd>
    </div>
  );
}

function Section({ title, children, bare, action }: { title: string; children: ReactNode; bare?: boolean; action?: ReactNode }) {
  return (
    <section className="sheet__section">
      <h3>
        {title}
        {action}
      </h3>
      {bare ? children : <dl>{children}</dl>}
    </section>
  );
}

/** Cifra destacada de «Compra prevista»: etiqueta pequeña arriba, valor grande debajo. */
function Kpi({ label, children, sub, edit }: { label: string; children: ReactNode; sub?: ReactNode; edit?: string }) {
  return (
    <div className="sheet-kpi" data-edit={edit}>
      <dt>{label}</dt>
      <dd>
        <span className="num">{children}</span>
        {sub && <span className="sheet__sub">{sub}</span>}
      </dd>
    </div>
  );
}

/**
 * Horquilla de los analistas: del objetivo más bajo al más alto, con la media y el precio de hoy
 * marcados, para ver de un vistazo cuánto recorrido le ven.
 */
function TargetRange({ low, high, mean, price }: { low: number; high: number; mean: number; price: number | null }) {
  const lo = Math.min(low, price ?? low);
  const hi = Math.max(high, price ?? high);
  const at = (v: number) => `${hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50}%`;
  return (
    <div className="sheet-range" aria-hidden>
      <div className="sheet-range__track">
        <span className="sheet-range__band" style={{ left: at(low), right: `calc(100% - ${at(high)})` }} />
        <span className="sheet-range__mean" style={{ left: at(mean) }} />
        {price != null && <span className="sheet-range__price" style={{ left: at(price) }} />}
      </div>
    </div>
  );
}

const Upside = ({ v }: { v: number | null }) =>
  v == null ? null : <span className={`delta ${v >= 0 ? 'up' : 'down'}`}>{pct(v, 1)}</span>;

/**
 * Ficha de datos del valor, al estilo de una hoja de cotización: etiqueta a la izquierda,
 * cifra alineada a la derecha. Solo aparece lo que existe (sin filas vacías con guiones).
 */
/**
 * onEdit: lápiz junto a «Tus precios de compra». Con `editing` la ficha no cambia de aspecto: sus
 * cifras editables (compras, orden, objetivo del bróker, compra prevista y notas) pasan a ser campos
 * en el mismo sitio. Se monta de nuevo al entrar a editar, para partir de los datos actuales.
 */
/**
 * Clic para editar (como Notion o Linear): pulsar una cifra editable o las notas abre la edición con
 * ese campo enfocado y el resto con aspecto de texto (`inline`); al salir de la ficha se guarda y Esc
 * lo deja como estaba. El lápiz sigue abriéndolo todo a la vez.
 */
export function QuoteSheet({ row, base, onEdit, editing = false, inline = false, focus = 'l0', onEditField, onDone, onMore }: {
  row: WatchlistRow;
  base: string;
  onEdit?: () => void;
  editing?: boolean;
  /** Edición de un solo campo: los demás parecen texto y al salir se guarda. */
  inline?: boolean;
  /** Campo que recibe el foco al entrar a editar (`data-field`). */
  focus?: string;
  /** Clic en una cifra o en las notas: edita ese campo. */
  onEditField?: (field: string) => void;
  onDone?: () => void;
  /** Abre el diálogo completo (símbolo, nombre, avisos, quitar de la lista). */
  onMore?: () => void;
}) {
  const { item, quote, targets, metrics } = row;
  const settings = useSettings().data;
  const names = settings?.statusNames ?? DEFAULT_STATUS_NAMES;
  const ed = useSheetDraft(row, onDone ?? (() => {}));
  const { d } = ed;
  const uid = useId();
  const root = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!editing) return;
    const el = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${focus}"]`);
    if (!el) return;
    el.focus();
    // Las cifras quedan seleccionadas para reescribirlas; en las notas, el cursor al final.
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    else if (el.type !== 'checkbox') el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  /** Clic en un dato editable (sin contar si se está seleccionando texto para copiarlo). */
  const clickToEdit = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-edit]');
    if (!target || !onEditField || !window.getSelection()?.isCollapsed) return;
    onEditField(target.dataset.edit!);
  };
  /** En la edición de un campo, salir de la ficha guarda (no si se cambia de ventana). */
  const leave = () => {
    if (!inline) return;
    setTimeout(() => {
      const form = root.current;
      if (form && document.hasFocus() && !form.contains(document.activeElement)) void ed.submit();
    });
  };
  const now = quote?.price ?? null;
  /** Distancia en vivo de lo que se escribe al precio de hoy. */
  const distTo = (v: string) => {
    const p = parseDecimal(v);
    return p != null && p > 0 && now ? p / now - 1 : null;
  };
  const cur = quote?.currency ?? base;
  /** Precios en la moneda del valor, con su símbolo. */
  const pr = (v: number | null | undefined) => price(v, quote?.currency);
  const keyDates = upcoming(row);
  const muted = isMuted(item.mutedUntil, localToday());
  /** Precio de la orden activa: el nivel que coincide se marca con su color. */
  const order = item.orderActive && item.orderPrice != null ? item.orderPrice : null;
  const orderLevel = order == null ? -1 : metrics.levels.findIndex((l) => Math.abs(l.price - order) < 1e-9);
  /** Plazo de la orden: «Orden en el banco hasta el 30/11/26 · 11 d». */
  const orderTerm = item.orderUntil
    ? `hasta el ${shortDate(item.orderUntil)}${metrics.orderExpired ? ' · caducada' : metrics.orderDaysLeft != null ? ` · ${metrics.orderDaysLeft} d` : ''}`
    : '';
  /** El consenso es una media: más de dos decimales es ruido (98,232 → 98,23). */
  const round2 = (v: number) => Math.round(v * 100) / 100;

  /** Las tres compras y la orden como campos, con estado y distancia recalculados al escribir. */
  const editLevels = (
    <ol className="sheet-levels">
      {d.levels.map((v, i) => {
        const p = parseDecimal(v);
        const st = p != null && p > 0 && settings ? levelStatus(p, now, settings.bands) : 'unknown';
        const dist = distTo(v);
        return (
          <li key={i} className={`sheet-level sheet-level--${st}`}>
            <span className="sheet-level__dot" />
            <label className="sheet-level__name" htmlFor={`${uid}-l${i}`}>
              Compra {i + 1}
              {st !== 'unknown' && <small>{names[st]}</small>}
            </label>
            <input
              id={`${uid}-l${i}`}
              data-field={`l${i}`}
              className="sheet-input num"
              inputMode="decimal"
              autoComplete="off"
              value={v}
              placeholder="–"
              onChange={(e) => ed.setLevel(i, e.target.value)}
            />
            <span className="sheet-level__dist num">{dist != null ? pct(dist, 1) : ''}</span>
          </li>
        );
      })}
      <li className={`sheet-level sheet-level--unknown${d.orderActive ? ' sheet-level--order' : ''}`}>
        <span className="sheet-level__dot" />
        <label className={`sheet-level__name sheet-check${d.orderActive ? '' : ' sheet-level__name--wide'}`}>
          <input type="checkbox" data-field="order" checked={d.orderActive} onChange={(e) => ed.set('orderActive', e.target.checked)} />
          Orden en el banco
        </label>
        {d.orderActive ? (
          <input
            className="sheet-input num"
            inputMode="decimal"
            autoComplete="off"
            aria-label="Precio de la orden"
            data-field="orderPrice"
            value={d.orderPrice}
            placeholder={d.levels[0] || cur}
            onChange={(e) => ed.set('orderPrice', e.target.value)}
          />
        ) : null}
        <span className="sheet-level__dist num">{d.orderActive ? pct(distTo(d.orderPrice || d.levels[0] || ''), 1) : ''}</span>
        {d.orderActive && (
          <label className="sheet-level__order sheet-level__until">
            Válida hasta
            <input className="sheet-input num" type="date" value={d.orderUntil} onChange={(e) => ed.set('orderUntil', e.target.value)} />
          </label>
        )}
      </li>
    </ol>
  );

  /** Solo lo editable responde al clic (no en la ficha de un valor que aún no está en la lista). */
  const tap = (field: string) => (!editing && onEditField ? field : undefined);
  return (
    <form
      ref={root}
      className={`sheet${editing ? ' sheet--editing' : ''}${editing && inline ? ' sheet--inline' : ''}${!editing && onEditField ? ' sheet--tappable' : ''}`}
      {...(editing
        ? { onSubmit: ed.submit, onKeyDown: ed.keys, onBlur: leave, 'aria-label': 'Editar los datos del valor' }
        : { onSubmit: (e: React.FormEvent) => e.preventDefault(), onClick: clickToEdit })}
    >
      <Section
        title="Tus precios de compra"
        bare
        action={
          editing ? (
            <span className="sheet__edit-actions">
              <button type="button" className="icon-btn sheet__edit" onClick={onDone} aria-label="Cancelar" title="Cancelar (Esc)">
                ×
              </button>
              <button type="submit" className="icon-btn sheet__edit sheet__save" disabled={ed.pending} aria-label="Guardar" title="Guardar (Intro)">
                <Icon name="check" />
              </button>
            </span>
          ) : (
            onEdit && (
              <button type="button" className="icon-btn sheet__edit" onClick={onEdit} aria-label="Editar precios, orden, objetivos y notas" title="Editar">
                <Icon name="pencil" />
              </button>
            )
          )
        }
      >
        {editing && ed.error && (
          <p className="error-box sheet__error" role="alert">
            {ed.error}
          </p>
        )}
        {/* Siempre las tres compras y la orden, con o sin datos: al editar no se mueve nada. */}
        {editing ? editLevels : (
          <ol className="sheet-levels">
            {[0, 1, 2].map((i) => {
              const l = metrics.levels[i];
              const st = l?.status ?? 'unknown';
              return (
                <li key={i} data-edit={tap(`l${i}`)} className={`sheet-level sheet-level--${st}${l && i === orderLevel ? ' sheet-level--order' : ''}`}>
                  <span className="sheet-level__dot" />
                  <span className="sheet-level__name">
                    Compra {i + 1}
                    {st !== 'unknown' && <small>{names[st]}</small>}
                  </span>
                  <span className={`sheet-level__price num${l ? '' : ' muted'}`}>{l ? pr(l.price) : '–'}</span>
                  <span className="sheet-level__dist num">{l ? pct(l.distancePct, 1) : ''}</span>
                  {l && i === orderLevel && <span className="sheet-level__order">Orden en el banco {orderTerm}</span>}
                </li>
              );
            })}
            {/* La orden va aparte si no está puesta o si su precio no es uno de tus niveles. */}
            {(!item.orderActive || orderLevel < 0) && (
              <li data-edit={tap(item.orderActive ? 'orderPrice' : 'order')} className={`sheet-level sheet-level--unknown${item.orderActive ? ' sheet-level--order' : ''}`}>
                <span className="sheet-level__dot" />
                <span className={`sheet-level__name${item.orderActive ? '' : ' sheet-level__name--wide'}`}>Orden en el banco</span>
                {item.orderActive && <span className="sheet-level__price num">{order != null ? pr(order) : 'Sin precio'}</span>}
                <span className={`sheet-level__dist num${item.orderActive ? '' : ' muted'}`}>
                  {!item.orderActive ? 'No' : order != null && quote?.price ? pct(order / quote.price - 1, 1) : ''}
                </span>
                {item.orderActive && orderTerm && <span className="sheet-level__order">{orderTerm.replace(/^h/, 'H')}</span>}
              </li>
            )}
          </ol>
        )}
      </Section>

      <Section title="Objetivos">
        {editing ? (
          <div className="sheet__row sheet__row--edit">
            <dt>
              {/* El nombre ocupa el sitio de la etiqueta «Bróker»: la fila no crece al editar. */}
              <input
                className="sheet-input sheet-input--text"
                aria-label="Nombre del bróker"
                data-field="brokerName"
                value={d.brokerName}
                placeholder="Bróker"
                maxLength={40}
                onChange={(e) => ed.set('brokerName', e.target.value)}
              />
            </dt>
            <dd>
              <input
                id={`${uid}-bt`}
                className="sheet-input num"
                aria-label="Objetivo del bróker"
                data-field="brokerTarget"
                inputMode="decimal"
                autoComplete="off"
                value={d.brokerTarget}
                placeholder="Objetivo"
                onChange={(e) => ed.set('brokerTarget', e.target.value)}
              />{' '}
              <Upside v={distTo(d.brokerTarget)} />
            </dd>
          </div>
        ) : (
          <Row edit={tap('brokerTarget')} label={item.brokerName ? `Bróker · ${item.brokerName}` : 'Bróker'}>
            {item.brokerTarget ? (
              <>
                <span className="num">{pr(item.brokerTarget)}</span> <Upside v={metrics.upsideBrokerPct} />
              </>
            ) : (
              <span className="muted">–</span>
            )}
          </Row>
        )}
        {targets?.mean ? (
          <div className="sheet__row sheet__row--consensus">
            <dt>
              Consenso
              <span className="sheet__sub">
                {[
                  targets.analysts != null && `${targets.analysts} analistas`,
                  targets.recommendation && targets.recommendation !== 'none' && (RECOMMENDATION_ES[targets.recommendation] ?? targets.recommendation),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </dt>
            <dd>
              <span className="num">{pr(round2(targets.mean))}</span> <Upside v={metrics.upsideConsensusPct} />
            </dd>
            {targets.low != null && targets.high != null && (
              <dd className="sheet__note sheet__range">
                <TargetRange low={targets.low} high={targets.high} mean={targets.mean} price={quote?.price ?? null} />
                <span className="sheet-range__ends num">
                  <span>Mín. {pr(round2(targets.low))}</span>
                  <span>Máx. {pr(round2(targets.high))}</span>
                </span>
              </dd>
            )}
          </div>
        ) : (
          <Row label="Consenso">
            <span className="muted">Sin datos</span>
          </Row>
        )}
      </Section>

      <Section title="Compra prevista" bare>
        <dl className="sheet-kpis">
          <Kpi label="Acciones" edit={tap('shares')} sub={metrics.sharesCalc != null && (editing ? !d.shares.trim() : item.sharesOverride == null) ? `calc. ${num(metrics.sharesCalc, 1)}` : undefined}>
            {editing ? (
              <input
                className="sheet-input sheet-input--kpi num"
                inputMode="numeric"
                autoComplete="off"
                aria-label="Acciones"
                data-field="shares"
                value={d.shares}
                placeholder={metrics.sharesCalc != null ? num(Math.ceil(metrics.sharesCalc)) : 'auto'}
                onChange={(e) => ed.set('shares', e.target.value)}
              />
            ) : metrics.shares != null ? num(metrics.shares) : '–'}
          </Kpi>
          <Kpi
            edit={tap('invest')}
            label="Importe"
            sub={!editing && cur !== base && metrics.netNative != null ? money(metrics.netNative, cur, 0, true) : undefined}
          >
            {editing ? (
              <input
                className="sheet-input sheet-input--kpi num"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Importe en ${base}`}
                data-field="invest"
                value={d.invest}
                placeholder={num(settings?.defaultInvest ?? 0)}
                onChange={(e) => ed.set('invest', e.target.value)}
              />
            ) : (
              money(metrics.netBase, base)
            )}
          </Kpi>
          <Kpi label="Ahorro">{money(metrics.diffBase, base)}</Kpi>
        </dl>
      </Section>

      <Section title="Empresa">
        {quote?.low52 != null && quote.high52 != null && (
          <Row label="Rango del año">
            <span className="num">
              {pr(quote.low52)} – {pr(quote.high52)}
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
        {/* Lo normal es tenerlos activados: solo se avisa cuando están silenciados. */}
        {muted && (
          <Row label="Avisos">
            {item.mutedUntil === 'always' ? 'Silenciados' : `Silenciados hasta el ${shortDate(item.mutedUntil)}`}
          </Row>
        )}
      </Section>

      {/* Notas siempre, aunque estén vacías: la caja es la misma al leer y al escribir. */}
      <section className="sheet__section sheet__notes">
        <h3>{editing ? <label htmlFor={`${uid}-notes`}>Notas</label> : 'Notas'}</h3>
        {editing ? (
          <textarea
            id={`${uid}-notes`}
            data-field="notes"
            className="sheet-input sheet-input--notes"
            maxLength={2000}
            value={d.notes}
            placeholder="Escribe una nota…"
            onChange={(e) => ed.set('notes', e.target.value)}
          />
        ) : (
          <p data-edit={tap('notes')} className={item.notes?.trim() ? undefined : 'sheet__notes-empty'}>{item.notes?.trim() || 'Sin notas'}</p>
        )}
        {/* Al final de la ficha: no empuja nada de lo de arriba. */}
        {editing && !inline && onMore && (
          <button type="button" className="link-btn sheet__more" onClick={onMore}>
            Más opciones (símbolo, avisos, quitar)…
          </button>
        )}
      </section>
    </form>
  );
}
