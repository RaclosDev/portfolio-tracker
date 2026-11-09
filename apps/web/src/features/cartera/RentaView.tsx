import { OPERATION_LABELS, type TaxYear } from '@watchlist/shared';
import { useState, type ReactNode } from 'react';
import { exportRenta } from '../../lib/excel.ts';
import { money, num, shortDate } from '../../lib/format.ts';
import { signed, type CarteraModel } from './model.ts';

const eur = (v: number | null | undefined) => money(v, 'EUR', 2);

function Line({ label, value, strong, help }: { label: ReactNode; value: number; strong?: boolean; help?: string }) {
  return (
    <tr className={strong ? 'renta-line--strong' : undefined}>
      <th scope="row" title={help}>
        {label}
      </th>
      <td className={`al-right num ${strong ? `delta ${signed(value)}` : ''}`}>{eur(value || 0)}</td>
    </tr>
  );
}

/** «Renta»: lo que hay que declarar cada año en la base del ahorro, con exportación a Excel e impresión. */
export function RentaView({ model }: { model: CarteraModel }) {
  const years = [...model.taxYears].reverse();
  const [year, setYear] = useState(() => years.find((y) => y.year < new Date().getFullYear())?.year ?? years[0]?.year);
  const [busy, setBusy] = useState(false);
  const y: TaxYear | undefined = years.find((x) => x.year === year);
  if (!y) return <p className="empty">No hay operaciones todavía.</p>;
  const name = (t: string) => model.names.get(t) ?? t;
  const carriedUsed = y.carriedUsed.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="renta">
      <div className="toolbar no-print">
        <label htmlFor="renta-year">Ejercicio</label>
        <select id="renta-year" className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((x) => (
            <option key={x.year} value={x.year}>
              {x.year}
              {x.year === new Date().getFullYear() ? ' (en curso)' : ''}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportRenta(y, model.names);
            } finally {
              setBusy(false);
            }
          }}
        >
          Descargar Excel
        </button>
        <button type="button" className="btn" onClick={() => window.print()} title="Imprimir o guardar como PDF">
          Imprimir / PDF
        </button>
      </div>

      <h2 className="renta__title">Renta {y.year} · base imponible del ahorro</h2>
      <div className="renta-grid">
        <table className="renta-summary">
          <caption>Ganancias y pérdidas patrimoniales</caption>
          <tbody>
            <Line label="Ganancias" value={y.gains} />
            <Line label="Pérdidas" value={y.losses} />
            <Line label="Saldo" value={y.gpBalance} strong />
          </tbody>
        </table>
        <table className="renta-summary">
          <caption>Rendimientos del capital mobiliario</caption>
          <tbody>
            <Line label="Dividendos y primas (bruto)" value={y.rcmGross} />
            <Line label="Gastos (comisiones)" value={-y.rcmFees} />
            <Line label="Saldo" value={y.rcmBalance} strong />
          </tbody>
        </table>
        <table className="renta-summary">
          <caption>Compensación y resultado estimado</caption>
          <tbody>
            {y.crossCompensation !== 0 && <Line label="Compensación entre saldos (hasta el 25 %)" value={y.crossCompensation} />}
            {carriedUsed > 0 && (
              <Line
                label={`Pérdidas de años anteriores (${y.carriedUsed.map((c) => c.year).join(', ')})`}
                value={-carriedUsed}
              />
            )}
            <Line label="Base imponible del ahorro" value={y.taxBase} strong />
            <Line label="Cuota estimada" value={y.taxEstimate} />
            <Line
              label={
                y.withholdingEsEstimated
                  ? `Retenciones (${eur(y.withholdingEsEstimated)} estimadas al 19 %)`
                  : y.withholdingEs === 0 && y.rcmBalance > 0
                    ? 'Retenciones en España (no apuntadas)'
                    : 'Retenciones en España'
              }
              help="Para años anteriores a 2026 importados del Excel no hay dato de retención: el resultado sale más alto de lo real"
              value={-y.withholdingEs}
            />
            {y.foreignDeduction > 0 && <Line label="Deducción doble imposición (estimada)" value={-y.foreignDeduction} />}
            <Line label={y.balanceEstimate >= 0 ? 'A pagar (estimado)' : 'A devolver (estimado)'} value={y.balanceEstimate} strong />
          </tbody>
        </table>
      </div>
      {(y.deferred > 0 || y.released > 0) && (
        <p className="notice">
          Regla de los dos meses:{' '}
          {[
            y.deferred > 0 && `${eur(y.deferred)} de pérdidas no se declaran este año porque recompraste en los dos meses (se integran al vender lo recomprado)`,
            y.released > 0 && `${eur(y.released)} de pérdidas aplazadas antes se integran en las ventas de este año (ya incluidas arriba)`,
          ]
            .filter(Boolean)
            .join('; ')}
          .
        </p>
      )}
      {y.carriedPending.length > 0 && (
        <p className="notice">
          Pérdidas pendientes de compensar en los próximos años:{' '}
          {y.carriedPending.map((c) => `${eur(c.amount)} de ${c.year} (hasta ${c.year + 4})`).join(' · ')}.
        </p>
      )}

      <h3 className="renta__h">Transmisiones ({y.sales.length + y.rights.length})</h3>
      {y.sales.length + y.rights.length === 0 ? (
        <p className="muted small">Sin ventas este año.</p>
      ) : (
        <div className="table-wrap">
          <table className="wl-table cartera-table">
            <thead>
              <tr>
                <th>Valor</th>
                <th>Venta</th>
                <th>Compra</th>
                <th className="al-right">Acciones</th>
                <th className="al-right">Transmisión</th>
                <th className="al-right">Adquisición</th>
                <th className="al-right">Resultado</th>
                <th className="al-right">Computable</th>
              </tr>
            </thead>
            <tbody>
              {y.sales.map((s) => (
                <tr key={`s${s.id}`}>
                  <td>
                    <div className="stack">
                      <span className="name">{name(s.ticker)}</span>
                      <span className="sub ticker">{s.ticker}</span>
                    </div>
                  </td>
                  <td className="num">{shortDate(s.date)}</td>
                  <td className="num small">{[...new Set(s.matches.map((m) => shortDate(m.buyDate)))].join(', ')}</td>
                  <td className="al-right num">{num(s.shares, Number.isInteger(s.shares) ? 0 : 3)}</td>
                  <td className="al-right num">{eur(s.proceedsEur)}</td>
                  <td className="al-right num">{eur(s.taxCostEur)}</td>
                  <td className={`al-right num delta ${signed(s.taxGainEur)}`}>{eur(s.taxGainEur)}</td>
                  <td className={`al-right num delta ${signed(s.computableEur)}`} title={s.deferredLossEur ? `Aplazados ${eur(s.deferredLossEur)} por recompra en dos meses` : undefined}>
                    {eur(s.computableEur)}
                    {s.deferredLossEur > 0 && <span className="badge badge--danger">2 meses</span>}
                  </td>
                </tr>
              ))}
              {y.rights.map((r) => (
                <tr key={`r${r.id}`}>
                  <td>
                    <div className="stack">
                      <span className="name">{name(r.ticker)}</span>
                      <span className="sub">Venta de derechos</span>
                    </div>
                  </td>
                  <td className="num">{shortDate(r.date)}</td>
                  <td />
                  <td />
                  <td className="al-right num">{eur(r.grossEur)}</td>
                  <td className="al-right num">{eur(r.feesEur)}</td>
                  <td className={`al-right num delta ${signed(r.gainEur)}`}>{eur(r.gainEur)}</td>
                  <td className={`al-right num delta ${signed(r.gainEur)}`}>{eur(r.gainEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="renta__h">Dividendos y primas ({y.rcmLines.length})</h3>
      {y.rcmLines.length === 0 ? (
        <p className="muted small">Sin cobros este año.</p>
      ) : (
        <div className="table-wrap">
          <table className="wl-table cartera-table">
            <thead>
              <tr>
                <th>Valor</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th className="al-right">Bruto</th>
                <th className="al-right">Comisiones</th>
                <th className="al-right">Ret. España</th>
                <th className="al-right">Ret. origen</th>
                <th className="al-right">Rendimiento</th>
              </tr>
            </thead>
            <tbody>
              {y.rcmLines.map(({ item: i, withholdingEs, estimated }) => (
                <tr key={i.id}>
                  <td>
                    <div className="stack">
                      <span className="name">{name(i.ticker)}</span>
                      <span className="sub ticker">{i.ticker}</span>
                    </div>
                  </td>
                  <td className="num">{shortDate(i.date)}</td>
                  <td>{OPERATION_LABELS[i.type]}</td>
                  <td className="al-right num">{eur(i.grossEur)}</td>
                  <td className="al-right num">{i.feesEur ? eur(i.feesEur) : ''}</td>
                  <td className="al-right num">
                    {eur(withholdingEs)}
                    {estimated && (
                      <span className="badge" title="No está apuntada: se estima al 19 %">
                        est.
                      </span>
                    )}
                  </td>
                  <td className="al-right num">{i.withholdingForeign ? eur(i.withholdingForeign) : ''}</td>
                  <td className="al-right num">{eur(i.rcmEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="footnote">
        Ayuda para preparar la declaración, no un cálculo oficial: FIFO por valor (todos los brókers juntos), regla de los dos
        meses, compensación del 25 % y arrastre de pérdidas cuatro años. La cuota usa la escala del ahorro estatal + autonómica
        general; compruébalo con los datos fiscales de la Agencia Tributaria.
      </p>
    </div>
  );
}
