import type { Operation } from '@watchlist/shared';
import { useEffect, useMemo, useState } from 'react';
import { money, pct } from '../../lib/format.ts';
import { CarteraImportDialog } from './CarteraImportDialog.tsx';
import { PortfolioCharts } from './PortfolioCharts.tsx';
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
  const complete = s.missing.length === 0;
  return (
    <div className="portfolio-summary">
    <section className="highlights cartera-totals" aria-label="Resumen de la cartera">
      <Figure
        label="Ganancia total · desde el inicio"
        value={money(complete ? s.totalEur : null, 'EUR', 2)}
        delta={s.totalEur}
        title="Resultado económico acumulado: latente + ganancias en ventas + cobros"
      />
      <Figure label="Valor actual en acciones" value={money(complete ? s.valueEur : null, 'EUR', 2)} title="Posiciones abiertas a precio de mercado. No incluye saldo en efectivo" />
      <Figure label="TIR anual · desde el inicio" value={pct(s.xirr, 2)} delta={s.xirr} title="Rentabilidad anualizada del dinero invertido según las fechas de compras, ventas y cobros, y el valor actual de las acciones" />
      <Figure label="Cotización de hoy" value={money(complete ? s.dayChangeEur : null, 'EUR', 2)} sub={pct(complete ? s.dayChangePct : null, 2)} delta={s.dayChangeEur}
        title="Variación de precio de las acciones que tienes ahora, al cambio actual. No es el resultado diario de la cuenta ni incluye ventas o cobros de hoy" />
      {s.missing.length > 0 && (
        <div className="hl-cell hl-cell--full">
          <p className="hl-value muted small">
            Falta valorar: {s.missing.join(', ')}. El total y el latente se mostrarán cuando la valoración esté completa.
          </p>
        </div>
      )}
    </section>
    <section className="cartera-breakdown" aria-label="Desglose del resultado">
      <h3>De dónde sale la ganancia total</h3>
      <div className="highlights">
        <Figure label="Latente" value={money(complete ? s.unrealizedEur : null, 'EUR', 2)} sub={pct(complete && s.costEur ? s.unrealizedEur / s.costEur : null)} delta={s.unrealizedEur} title="Ganancia o pérdida de las acciones que sigues teniendo" />
        <Figure label="Ganancia en ventas" value={money(s.realizedEur, 'EUR', 2)} delta={s.realizedEur} title="Importe de las ventas menos el coste FIFO de las acciones vendidas" />
        <Figure label="Cobros" value={money(s.incomeEur, 'EUR', 2)} title="Dividendos y primas (bruto − comisiones − retención en origen)" />
      </div>
    </section>
    </div>
  );
}

function ResumenView({ model }: { model: CarteraModel }) {
  const { open } = model.valuation;
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
    <div className="portfolio-overview">
      <div className="portfolio-ledger">
        <Totals model={model} />
        <section className="portfolio-annual" aria-labelledby="annual-results-title">
          <h3 id="annual-results-title" className="renta__h">Ventas y cobros por año</h3>
          <p className="small muted">Ganancias realizadas y cobros. No incluye la variación del latente.</p>
          <div className="table-wrap" role="region" aria-label="Detalle anual de ventas y cobros" tabIndex={0}>
            <table className="wl-table cartera-table">
              <thead>
                <tr>
                  <th scope="col">Año</th>
                  <th scope="col" className="al-right">Ganancia en ventas</th>
                  <th scope="col" className="al-right">Dividendos</th>
                  <th scope="col" className="al-right">Otros cobros</th>
                  <th scope="col" className="al-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {years.length === 0 && <tr><td colSpan={5} className="muted">Todavía no hay ventas ni cobros registrados.</td></tr>}
                {years.map(([y, v]) => {
                  const total = v.realized + v.dividends + v.other;
                  return (
                    <tr key={y}>
                      <td className="num">{y}</td>
                      <td className={`al-right num delta ${signed(v.realized)}`}>{money(v.realized, 'EUR', 2)}</td>
                      <td className="al-right num">{money(v.dividends, 'EUR', 2)}</td>
                      <td className="al-right num">{money(v.other, 'EUR', 2)}</td>
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
              {years.length > 0 && <tfoot><tr>
                <th scope="row">Total</th>
                <td className={`al-right num delta ${signed(s.realizedEur)}`}>{money(s.realizedEur, 'EUR', 2)}</td>
                <td className="al-right num">{money(s.dividendsEur, 'EUR', 2)}</td>
                <td className="al-right num">{money(s.otherIncomeEur, 'EUR', 2)}</td>
                <td className={`al-right num delta ${signed(s.realizedEur + s.incomeEur)}`}>{money(s.realizedEur + s.incomeEur, 'EUR', 2)}</td>
              </tr></tfoot>}
            </table>
          </div>
        </section>
      </div>
      <div className="portfolio-analytics">
        <PortfolioCharts model={model} byBroker={byBroker} />
        <section className="portfolio-lifetime" aria-label="Desde el principio">
          <h3 className="renta__h">Desde el principio</h3>
          <table className="renta-summary">
            <tbody>
              <tr>
                <th scope="row">Compras acumuladas</th>
                <td className="al-right num">{money(s.boughtEur, 'EUR', 2)}</td>
              </tr>
              <tr>
                <th scope="row">Coste de lo que tienes</th>
                <td className="al-right num">{money(model.ledger.tickers.reduce((sum, t) => sum + t.costEur, 0), 'EUR', 2)}</td>
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
        </section>
      </div>
    </div>
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
          <button type="button" className="btn btn--primary" data-tour="operation" onClick={() => setEditing({ op: null })}>
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
      {model.ledger.inTransitEur > 0 && <p className="muted">
        Hay {money(model.ledger.inTransitEur, 'EUR', 2)} en traspasos pendientes de entrada. Este importe está incluido en el valor de la cartera.
      </p>}

      {empty ? (
        <div className="empty">
          <p>Todavía no hay operaciones. Importa un Excel o CSV de tu bróker o añade la primera compra.</p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={() => setImporting(true)}>
              Importar operaciones
            </button>
            <button type="button" className="btn" data-tour="operation" onClick={() => setEditing({ op: null })}>
              Añadir operación
            </button>
          </div>
        </div>
      ) : (
        <>
          {tab === 'resumen' && <ResumenView model={model} />}
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
        <CarteraImportDialog view={model.view} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}
