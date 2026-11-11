import type { Operation } from '@watchlist/shared';
import { useEffect, useMemo, useState } from 'react';
import { money, pct } from '../../lib/format.ts';
import { CarteraImportDialog } from './CarteraImportDialog.tsx';
import { Donut } from './Donut.tsx';
import { ClosedView, HoldingsView } from './HoldingsView.tsx';
import { signed, type CarteraModel } from './model.ts';
import { OperationDialog, type OperationDraft } from './OperationDialog.tsx';
import { RegistroView } from './RegistroView.tsx';
import { RentaView } from './RentaView.tsx';
import { TickerDialog } from './TickerDialog.tsx';

type Tab = 'resumen' | 'abiertas' | 'cerradas' | 'registro' | 'renta';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'abiertas', label: 'En cartera' },
  { id: 'cerradas', label: 'Cerradas' },
  { id: 'registro', label: 'Registro' },
  { id: 'renta', label: 'Renta' },
];
const TAB_KEY = 'watchlist.cartera.pestana';

function Figure({ label, value, sub, delta, title }: { label: string; value: string; sub?: string; delta?: number | null; title?: string }) {
  return (
    <div className="hl-cell" title={title}>
      <p className="hl-label">{label}</p>
      <p className={`hl-figure num${delta !== undefined ? ` delta ${signed(delta)}` : ''}`}>
        {value} {sub && <small>{sub}</small>}
      </p>
    </div>
  );
}

function Totals({ model }: { model: CarteraModel }) {
  const s = model.valuation.summary;
  return (
    <>
    <section className="highlights cartera-totals" aria-label="Resumen de la cartera">
      <Figure label="Valor actual" value={money(s.valueEur, 'EUR', 2)} />
      <Figure label="Hoy" value={money(s.dayChangeEur, 'EUR', 2)} sub={pct(s.dayChangePct, 2)} delta={s.dayChangeEur} />
      <Figure
        label="Total"
        value={money(s.totalEur, 'EUR', 2)}
        sub={s.xirr != null ? `TIR ${pct(s.xirr).replace('+', '')}` : undefined}
        delta={s.totalEur}
        title="Latente + realizado + cobros. TIR: rentabilidad anual del dinero invertido"
      />
      {s.missing.length > 0 && (
        <div className="hl-cell hl-cell--full">
          <p className="hl-value muted small">
            Sin precio ahora mismo: {s.missing.join(', ')}. No suman en el valor ni en el latente (revisa su símbolo de Yahoo en
            la ficha del valor).
          </p>
        </div>
      )}
    </section>
    <details className="cartera-breakdown">
      <summary>Desglose del resultado</summary>
      <div className="highlights">
        <Figure label="Latente" value={money(s.unrealizedEur, 'EUR', 2)} sub={pct(s.costEur ? s.unrealizedEur / s.costEur : null)} delta={s.unrealizedEur} />
        <Figure label="Realizado" value={money(s.realizedEur, 'EUR', 2)} delta={s.realizedEur} title="Resultado de todas las ventas" />
        <Figure label="Cobros" value={money(s.incomeEur, 'EUR', 2)} title="Dividendos y primas (bruto − comisiones − retención en origen)" />
      </div>
    </details>
    </>
  );
}

/** Pestaña Resumen: reparto de la cartera y resultados por año. */
function ResumenView({ model }: { model: CarteraModel }) {
  const { open, bySector } = model.valuation;
  const byBroker = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of open) {
      if (r.valueEur == null || r.ledger.shares <= 0) continue;
      const per = r.valueEur / r.ledger.shares;
      for (const [b, n] of Object.entries(r.ledger.sharesByBroker)) if (n > 0) m.set(b, (m.get(b) ?? 0) + n * per);
    }
    return [...m].map(([label, value]) => ({ label, value }));
  }, [open]);
  const years = useMemo(() => {
    const m = new Map<number, { realized: number; dividends: number; other: number }>();
    const get = (y: number) => m.get(y) ?? (m.set(y, { realized: 0, dividends: 0, other: 0 }), m.get(y)!);
    for (const s of model.ledger.sales) get(s.year).realized += s.gainEur;
    for (const i of model.ledger.income) {
      if (i.type === 'dividend' || i.type === 'attendance_premium') get(i.year).dividends += i.econEur;
      else get(i.year).other += i.econEur;
    }
    return [...m].sort((a, b) => b[0] - a[0]);
  }, [model.ledger]);
  const max = Math.max(1, ...years.map(([, v]) => Math.abs(v.realized + v.dividends + v.other)));
  const s = model.valuation.summary;

  return (
    <>
      <div className="donuts">
        <Donut title="Por valor" slices={open.map((r) => ({ label: r.name, value: r.valueEur ?? 0 }))} />
        <Donut title="Por sector" slices={bySector.map((x) => ({ label: x.sector, value: x.valueEur }))} />
        <Donut title="Por bróker" slices={byBroker} />
      </div>
      <div className="resumen-grid">
        <div>
          <h3 className="renta__h">Resultado por año</h3>
          <div className="table-wrap">
            <table className="wl-table cartera-table">
              <thead>
                <tr>
                  <th>Año</th>
                  <th className="al-right">Ventas</th>
                  <th className="al-right">Dividendos</th>
                  <th className="al-right">Otros cobros</th>
                  <th className="al-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {years.map(([y, v]) => {
                  const total = v.realized + v.dividends + v.other;
                  return (
                    <tr key={y}>
                      <td className="num">{y}</td>
                      <td className={`al-right num delta ${signed(v.realized)}`}>{money(v.realized, 'EUR', 2)}</td>
                      <td className="al-right num">{money(v.dividends, 'EUR', 2)}</td>
                      <td className="al-right num">{v.other ? money(v.other, 'EUR', 2) : ''}</td>
                      <td className="al-right">
                        <span className="databar">
                          <span
                            className={`databar__fill${total < 0 ? ' databar__fill--neg' : ''}`}
                            style={{ width: `${(Math.abs(total) / max) * 100}%` }}
                            aria-hidden
                          />
                          <span className={`databar__text num delta ${signed(total)}`}>{money(total, 'EUR', 2)}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="renta__h">Desde el principio</h3>
          <table className="renta-summary">
            <tbody>
              <tr>
                <th scope="row">Invertido en compras</th>
                <td className="al-right num">{money(s.boughtEur, 'EUR', 2)}</td>
              </tr>
              <tr>
                <th scope="row">Coste de lo que tienes</th>
                <td className="al-right num">{money(s.costEur, 'EUR', 2)}</td>
              </tr>
              <tr>
                <th scope="row">Dividendos</th>
                <td className="al-right num">{money(s.dividendsEur, 'EUR', 2)}</td>
              </tr>
              <tr>
                <th scope="row">Primas y derechos</th>
                <td className="al-right num">{money(s.otherIncomeEur, 'EUR', 2)}</td>
              </tr>
              <tr>
                <th scope="row">Valores en cartera / cerrados</th>
                <td className="al-right num">
                  {model.valuation.open.length} / {model.valuation.closed.length}
                </td>
              </tr>
              <tr>
                <th scope="row">Operaciones</th>
                <td className="al-right num">{model.view.operations.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

interface Props {
  model: CarteraModel | null;
  isPending: boolean;
  error: Error | null;
  /** Alta que llega desde fuera («Lo he comprado» en la lista de vigilancia). */
  draft?: OperationDraft | null;
  onDraftUsed?: () => void;
}

/** Cartera real a partir del registro de operaciones (FIFO), con resumen, cerradas, registro y Renta. */
export function CarteraPage({ model, isPending, error, draft, onDraftUsed }: Props) {
  const [tab, setTab] = useState<Tab>(() => TABS.find((item) => item.id === localStorage.getItem(TAB_KEY))?.id ?? 'resumen');
  useEffect(() => localStorage.setItem(TAB_KEY, tab), [tab]);
  const [ticker, setTicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ op: Operation | null; draft?: OperationDraft } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (draft) {
      setEditing({ op: null, draft });
      onDraftUsed?.();
    }
  }, [draft, onDraftUsed]);

  if (error) return <p className="error-box">No se pudo cargar la cartera: {error.message}</p>;
  if (isPending || !model) return <p className="muted center">Cargando la cartera…</p>;
  const empty = model.view.operations.length === 0;
  const reviewCount = model.view.operations.filter((o) => o.needsReview).length;

  return (
    <div className="cartera">
      <div className="toolbar cartera-toolbar no-print">
        <div className="segmented cartera-tabs" role="tablist" aria-label="Secciones de la cartera">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={tab === t.id ? 'on' : ''}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'abiertas' && <span className="count">{model.valuation.open.length}</span>}
              {t.id === 'cerradas' && <span className="count">{model.valuation.closed.length}</span>}
              {t.id === 'registro' && reviewCount > 0 && (
                <span className="count count--warn" title={`${reviewCount} operaciones marcadas para revisar`}>
                  {reviewCount} por revisar
                </span>
              )}
            </button>
          ))}
        </div>
        <select className="select cartera-tab-select" aria-label="Sección de Cartera" value={tab} onChange={(e) => {
          const next = TABS.find((item) => item.id === e.target.value);
          if (next) setTab(next.id);
        }}>
          {TABS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="spacer" />
        {!empty && tab !== 'renta' && (
          <button type="button" className="btn btn--primary" onClick={() => setEditing({ op: null })}>
            Añadir operación
          </button>
        )}
      </div>

      {model.ledger.issues.length > 0 && (
        <div className="error-box">
          El registro no cuadra:{' '}
          {model.ledger.issues
            .slice(0, 3)
            .map((i) => `${i.ticker} ${i.date}: ${i.message}`)
            .join(' · ')}
        </div>
      )}

      {empty ? (
        <div className="empty">
          <p>Todavía no hay operaciones. Importa tu Excel de cartera (hoja Registro) o añade la primera compra.</p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={() => setImporting(true)}>
              Importar Excel
            </button>
            <button type="button" className="btn" onClick={() => setEditing({ op: null })}>
              Añadir operación
            </button>
          </div>
        </div>
      ) : (
        <>
          {tab === 'resumen' && <><Totals model={model} /><ResumenView model={model} /></>}
          {tab === 'abiertas' && <HoldingsView model={model} onOpen={setTicker} />}
          {tab === 'cerradas' && <ClosedView model={model} onOpen={setTicker} />}
          {tab === 'registro' && <RegistroView model={model} onImport={() => setImporting(true)} onEdit={(op) => setEditing({ op })} />}
          {tab === 'renta' && <RentaView model={model} />}
        </>
      )}

      {ticker && !editing && (
        <TickerDialog
          model={model}
          ticker={ticker}
          onClose={() => setTicker(null)}
          onEditOperation={(op) => setEditing({ op })}
          onAddOperation={(t) => setEditing({ op: null, draft: { ticker: t } })}
        />
      )}
      {editing && (
        <OperationDialog
          operation={editing.op}
          draft={editing.draft}
          instruments={model.view.instruments}
          brokers={model.brokers}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <CarteraImportDialog hasExcelData={model.view.operations.some((o) => o.source === 'excel')} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}
