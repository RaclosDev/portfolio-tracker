import { OPERATION_LABELS, type TaxYear } from '@watchlist/shared';
import { useState, type ReactNode } from 'react';
import { exportRenta } from '../../lib/excel.ts';
import { money, qty, shortDate } from '../../lib/format.ts';
import { signed, type CarteraModel } from './model.ts';
import { SelectMenu } from '../../components/SelectMenu.tsx';

const eur = (v: number | null | undefined) => money(v, 'EUR', 2);

/** Fechas de compra de una venta FIFO: hasta dos y «+N» para el resto, en vez de una lista interminable. */
function buyDates(dates: string[]) {
  const unique = [...new Set(dates)].sort();
  const shown = unique.slice(0, 2).map(shortDate).join(', ');
  return unique.length > 2 ? <span title={unique.map(shortDate).join(', ')}>{shown} <span className="muted">+{unique.length - 2}</span></span> : shown;
}

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
  if (!y) return <p className="empty">Todavía no hay nada que declarar: aquí saldrán las ganancias y pérdidas de las ventas y los dividendos y otros cobros de cada año.</p>;
  const name = (t: string) => model.names.get(t) ?? t;
  const carriedUsed = y.carriedUsed.reduce((s, c) => s + c.amount, 0);
  const pays = y.balanceEstimate >= 0;
  const sales = y.sales.length + y.rights.length;
  // «Computable» solo aporta si la regla de los dos meses cambia algún resultado.
  const showComputable = y.sales.some((s) => Math.abs(s.computableEur - s.taxGainEur) > 0.005);
  const hasFees = y.rcmLines.some((l) => l.item.feesEur);
  const hasForeign = y.rcmLines.some((l) => l.item.withholdingForeign);
  const hasEs = y.rcmLines.some((l) => l.withholdingEs);
  const salesTotals = {
    proceeds: y.sales.reduce((a, s) => a + s.proceedsEur, 0) + y.rights.reduce((a, r) => a + r.grossEur, 0),
    cost: y.sales.reduce((a, s) => a + s.taxCostEur, 0) + y.rights.reduce((a, r) => a + (r.feesEur ?? 0), 0),
    gain: y.sales.reduce((a, s) => a + s.taxGainEur, 0) + y.rights.reduce((a, r) => a + r.gainEur, 0),
  };

  return (
    <div className="renta">
      <div className="toolbar no-print">
        <label htmlFor="renta-year">Ejercicio</label>
        <SelectMenu<number>
          id="renta-year"
          label="Ejercicio"
          value={year ?? 0}
          onChange={setYear}
          options={years.map((x) => ({ value: x.year, label: `${x.year}${x.year === new Date().getFullYear() ? ' (en curso)' : ''}` }))}
        />
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

      <section className="pcard renta-hero" aria-label={`Resultado estimado de ${y.year}`}>
        <div className="renta-hero__main">
          <p className="hl-label">Renta {y.year}{y.year === new Date().getFullYear() ? ' (en curso)' : ''} · {pays ? 'a pagar' : 'a devolver'} (estimado)</p>
          <p className={`renta-hero__figure num${pays ? '' : ' delta up'}`}>{eur(Math.abs(y.balanceEstimate))}</p>
          <p className="renta-hero__calc num">
            Cuota {eur(y.taxEstimate)} {y.withholdingEs ? `− retenciones ${eur(y.withholdingEs)}` : '· sin retenciones apuntadas'}
            {y.foreignDeduction > 0 && <> − doble imposición {eur(y.foreignDeduction)}</>}
          </p>
        </div>
        <dl className="renta-hero__parts">
          <div><dt>Base imponible del ahorro</dt><dd className="num">{eur(y.taxBase)}</dd></div>
          <div><dt>Ganancias patrimoniales</dt><dd className={`num delta ${signed(y.gpBalance)}`}>{eur(y.gpBalance)}</dd></div>
          <div><dt>Capital mobiliario</dt><dd className={`num delta ${signed(y.rcmBalance)}`}>{eur(y.rcmBalance)}</dd></div>
        </dl>
      </section>

      <div className="renta-grid">
        <section className="pcard">
          <div className="pcard__head"><h2>Ganancias y pérdidas <span className="pcard__sub">· ventas</span></h2></div>
          <table className="renta-summary">
            <tbody>
              {y.losses !== 0 && <Line label="Ganancias" value={y.gains} />}
              {y.losses !== 0 && <Line label="Pérdidas" value={y.losses} />}
              <Line label="Saldo" value={y.gpBalance} strong />
            </tbody>
          </table>
          {(y.deferred > 0 || y.released > 0) && (
            <p className="pcard__note">
              Regla de los dos meses:{' '}
              {[
                y.deferred > 0 && `${eur(y.deferred)} de pérdidas no cuentan este año porque recompraste en los dos meses (contarán al vender lo recomprado)`,
                y.released > 0 && `${eur(y.released)} de pérdidas aplazadas antes cuentan ya en las ventas de este año`,
              ]
                .filter(Boolean)
                .join('; ')}
              .
            </p>
          )}
        </section>
        <section className="pcard">
          <div className="pcard__head"><h2>Capital mobiliario <span className="pcard__sub">· dividendos y primas</span></h2></div>
          <table className="renta-summary">
            <tbody>
              {y.rcmFees !== 0 && <Line label="Ingresos íntegros" value={y.rcmGross} />}
              {y.rcmFees !== 0 && <Line label="Gastos (comisiones)" value={-y.rcmFees} />}
              <Line label="Saldo" value={y.rcmBalance} strong />
            </tbody>
          </table>
          {y.withholdingEsEstimated > 0 && (
            <p className="pcard__note">{eur(y.withholdingEsEstimated)} de retenciones no estaban apuntadas: se estiman al 19 %.</p>
          )}
        </section>
        <section className="pcard">
          <div className="pcard__head"><h2>De la base a la cuota</h2></div>
          <table className="renta-summary">
            <tbody>
              {y.crossCompensation !== 0 && <Line label="Compensación entre saldos (hasta el 25 %)" value={y.crossCompensation} />}
              {carriedUsed > 0 && <Line label={`Pérdidas de ${y.carriedUsed.map((c) => c.year).join(', ')}`} value={-carriedUsed} />}
              <Line label="Base imponible" value={y.taxBase} />
              <Line label="Cuota estimada" value={y.taxEstimate} />
              <Line
                label={y.withholdingEs === 0 && y.rcmBalance > 0 ? 'Retenciones (no apuntadas)' : 'Retenciones en España'}
                help="Para años anteriores a 2026 importados del Excel no hay dato de retención: el resultado sale más alto de lo real"
                value={-y.withholdingEs}
              />
              {y.foreignDeduction > 0 && <Line label="Doble imposición (estimada)" value={-y.foreignDeduction} />}
              <Line label={pays ? 'A pagar' : 'A devolver'} value={Math.abs(y.balanceEstimate)} strong />
            </tbody>
          </table>
          {y.carriedPending.length > 0 && (
            <p className="pcard__note">
              Pérdidas por compensar más adelante:{' '}
              {y.carriedPending.map((c) => `${eur(c.amount)} de ${c.year}${c.kind === 'rcm' ? ' (RCM)' : ''}, hasta ${c.year + 4}`).join(' · ')}.
            </p>
          )}
        </section>
      </div>

      <section className="pcard renta-block">
        <div className="pcard__head">
          <h2>Transmisiones <span className="pcard__sub">· {sales} {sales === 1 ? 'venta' : 'ventas'}</span></h2>
        </div>
        {sales === 0 ? (
          <p className="pcard__note">Sin ventas en {y.year}.</p>
        ) : (
          <div className="table-wrap">
            <table className="wl-table cartera-table renta-table">
              <thead>
                <tr>
                  <th>Valor</th>
                  <th>Venta</th>
                  <th>Compra</th>
                  <th className="al-right">Acciones</th>
                  <th className="al-right">Transmisión</th>
                  <th className="al-right">Adquisición</th>
                  <th className="al-right">Resultado</th>
                  {showComputable && <th className="al-right" title="Lo que se declara tras aplicar la regla de los dos meses">Computable</th>}
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
                    <td className="num">{buyDates(s.matches.map((m) => m.buyDate))}</td>
                    <td className="al-right num">{qty(s.shares)}</td>
                    <td className="al-right num">{eur(s.proceedsEur)}</td>
                    <td className="al-right num">{eur(s.taxCostEur)}</td>
                    <td className={`al-right num delta ${signed(s.taxGainEur)}`}>{eur(s.taxGainEur)}</td>
                    {showComputable && (
                      <td className={`al-right num delta ${signed(s.computableEur)}`} title={s.deferredLossEur ? `Aplazados ${eur(s.deferredLossEur)} por recompra en dos meses` : undefined}>
                        {s.deferredLossEur > 0 && <span className="badge badge--danger">2 meses</span>} {eur(s.computableEur)}
                      </td>
                    )}
                  </tr>
                ))}
                {y.rights.map((r) => (
                  <tr key={`r${r.id}`}>
                    <td>
                      <div className="stack">
                        <span className="name">{name(r.ticker)}</span>
                        <span className="sub"><span className="ticker">{r.ticker}</span> · venta de derechos</span>
                      </div>
                    </td>
                    <td className="num">{shortDate(r.date)}</td>
                    <td />
                    <td />
                    <td className="al-right num">{eur(r.grossEur)}</td>
                    <td className="al-right num">{r.feesEur ? eur(r.feesEur) : ''}</td>
                    <td className={`al-right num delta ${signed(r.gainEur)}`}>{eur(r.gainEur)}</td>
                    {showComputable && <td className={`al-right num delta ${signed(r.gainEur)}`}>{eur(r.gainEur)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>Total</th>
                  <td className="al-right num">{eur(salesTotals.proceeds)}</td>
                  <td className="al-right num">{eur(salesTotals.cost)}</td>
                  <td className={`al-right num delta ${signed(salesTotals.gain)}`}>{eur(salesTotals.gain)}</td>
                  {showComputable && <td className={`al-right num delta ${signed(y.gpBalance)}`}>{eur(y.gpBalance)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="pcard renta-block">
        <div className="pcard__head">
          <h2>Dividendos y primas <span className="pcard__sub">· {y.rcmLines.length} {y.rcmLines.length === 1 ? 'cobro' : 'cobros'}</span></h2>
        </div>
        {y.rcmLines.length === 0 ? (
          <p className="pcard__note">Sin cobros en {y.year}.</p>
        ) : (
          <div className="table-wrap">
            <table className="wl-table cartera-table renta-table">
              <thead>
                <tr>
                  <th>Valor</th>
                  <th>Fecha</th>
                  {hasFees && <th className="al-right">Bruto</th>}
                  {hasFees && <th className="al-right">Comisiones</th>}
                  {hasEs && <th className="al-right">Ret. España</th>}
                  {hasForeign && <th className="al-right">Ret. origen</th>}
                  <th className="al-right">Rendimiento</th>
                </tr>
              </thead>
              <tbody>
                {y.rcmLines.map(({ item: i, withholdingEs, estimated }) => (
                  <tr key={i.id}>
                    <td>
                      <div className="stack">
                        <span className="name">{name(i.ticker)}</span>
                        <span className="sub"><span className="ticker">{i.ticker}</span>{i.type !== 'dividend' && ` · ${OPERATION_LABELS[i.type].toLowerCase()}`}</span>
                      </div>
                    </td>
                    <td className="num">{shortDate(i.date)}</td>
                    {hasFees && <td className="al-right num">{eur(i.grossEur)}</td>}
                    {hasFees && <td className="al-right num">{i.feesEur ? eur(i.feesEur) : ''}</td>}
                    {hasEs && <td className="al-right num">
                      {estimated && <span className="badge" title="No está apuntada: se estima al 19 %">est.</span>} {eur(withholdingEs)}
                    </td>}
                    {hasForeign && <td className="al-right num">{i.withholdingForeign ? eur(i.withholdingForeign) : ''}</td>}
                    <td className="al-right num">{eur(i.rcmEur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Total</th>
                  {hasFees && <td className="al-right num">{eur(y.rcmGross)}</td>}
                  {hasFees && <td className="al-right num">{eur(y.rcmFees)}</td>}
                  {hasEs && <td className="al-right num">{eur(y.withholdingEs)}</td>}
                  {hasForeign && <td className="al-right num">{eur(y.withholdingForeign)}</td>}
                  <td className="al-right num">{eur(y.rcmBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <p className="footnote">
        Ayuda para preparar la declaración, no un cálculo oficial: FIFO por valor (todos los brókers juntos), regla de los dos
        meses, compensación del 25 % y arrastre de pérdidas cuatro años. La cuota usa la escala del ahorro estatal + autonómica
        general; compruébalo con los datos fiscales de la Agencia Tributaria.
      </p>
    </div>
  );
}
