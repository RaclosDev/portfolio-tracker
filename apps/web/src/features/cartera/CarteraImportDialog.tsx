import {
  computeLedger,
  operationInputSchema,
  parseRegistro,
  parseResumenTotals,
  type Cell,
  type ExcelTotals,
  type RegistroParse,
} from '@watchlist/shared';
import { useMemo, useState } from 'react';
import { useOperationMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { readSpreadsheet } from '../../lib/excel.ts';
import { money } from '../../lib/format.ts';

/** Bróker de partida de cada valor del Excel (decidido con el usuario; se puede cambiar aquí y después). */
const BROKER_RULES: Record<string, { broker: string; review: boolean }> = {
  TEF: { broker: 'ING', review: false },
  OHLA: { broker: 'ING', review: false },
  CASH: { broker: 'MyInvestor', review: true },
};
const DEFAULT_BROKER = { broker: 'MyInvestor', review: false };

interface TickerSetup {
  ticker: string;
  symbol: string;
  currency: string;
  broker: string;
  review: boolean;
  ops: number;
}

/** Importa la hoja «Registro» del Excel de cartera: sustituye lo importado antes (hace copia antes). */
export function CarteraImportDialog({ hasExcelData, onClose }: { hasExcelData: boolean; onClose: () => void }) {
  const { importCartera } = useOperationMutations();
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<RegistroParse | null>(null);
  const [excelTotals, setExcelTotals] = useState<ExcelTotals | null>(null);
  const [setup, setSetup] = useState<TickerSetup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async (file: File) => {
    setError(null);
    setDone(null);
    setParsed(null);
    try {
      const sheets = await readSpreadsheet(file);
      const registro = sheets.find((s) => s.name.trim().toLowerCase() === 'registro') ?? sheets[0];
      if (!registro) throw new Error('El fichero no tiene hojas.');
      const p = parseRegistro(registro.data as Cell[][]);
      const resumen = sheets.find((s) => s.name.toLowerCase().startsWith('resumen'));
      setExcelTotals(resumen ? parseResumenTotals(resumen.data as Cell[][]) : null);
      setParsed(p);
      setFileName(file.name);
      setSetup(
        p.instruments.map((i) => {
          const rule = BROKER_RULES[i.ticker] ?? DEFAULT_BROKER;
          return {
            ticker: i.ticker,
            symbol: i.symbol ?? '',
            currency: i.currency ?? 'EUR',
            broker: rule.broker,
            review: rule.review,
            ops: p.operations.filter((o) => o.ticker === i.ticker).length,
          };
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const operations = useMemo(() => {
    if (!parsed) return [];
    const by = new Map(setup.map((s) => [s.ticker, s]));
    return parsed.operations.map((o) => {
      const s = by.get(String(o.ticker).toUpperCase());
      return { ...o, broker: s?.broker.trim() || null, needsReview: s?.review ?? false };
    });
  }, [parsed, setup]);

  const preview = useMemo(() => {
    if (!operations.length) return null;
    try {
      const ledger = computeLedger(operations.map((o, i) => ({ id: i + 1, ...operationInputSchema.parse(o) })));
      const realized = ledger.tickers.reduce((s, t) => s + t.realizedEur, 0);
      const income = ledger.tickers.reduce((s, t) => s + t.dividendsEur + t.otherIncomeEur, 0);
      const openCost = ledger.tickers.reduce((s, t) => s + t.costEur, 0);
      return { ledger, realized, income, openCost, open: ledger.tickers.filter((t) => t.shares > 1e-9).length };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [operations]);

  const patch = (ticker: string, p: Partial<TickerSetup>) => setSetup((all) => all.map((s) => (s.ticker === ticker ? { ...s, ...p } : s)));

  const submit = async () => {
    if (!parsed) return;
    setError(null);
    try {
      const res = await importCartera.mutateAsync({
        instruments: setup.map((s) => ({ ticker: s.ticker, symbol: s.symbol.trim() || null, currency: s.currency || 'EUR' })),
        operations,
      });
      setDone(
        `Importadas ${res.imported} operaciones${res.replaced ? ` (sustituyen a ${res.replaced} importadas antes)` : ''}.${
          res.savedTo ? ' Lo anterior quedó guardado en una copia (Ajustes › Copias).' : ''
        }`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const ok = preview && !('error' in preview) && preview.ledger.issues.length === 0;
  const excelOpenCost = excelTotals?.valueEur != null && excelTotals.unrealizedEur != null ? excelTotals.valueEur - excelTotals.unrealizedEur : null;

  return (
    <Dialog
      title="Importar el Excel de la cartera"
      onClose={onClose}
      wide
      className="dialog--xl"
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {done ? 'Cerrar' : 'Cancelar'}
          </button>
          {!done && (
            <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={!ok || importCartera.isPending}>
              {importCartera.isPending ? 'Importando…' : `Importar ${operations.length} operaciones`}
            </button>
          )}
        </>
      }
    >
      <p className="muted small">
        Lee la hoja <strong>Registro</strong> (una fila por compra, venta, dividendo, scrip…). Los dividendos se guardan en
        bruto. {hasExcelData && 'Sustituye todo lo importado antes del Excel; lo que hayas añadido a mano se queda. '}
        Antes de importar se guarda una copia de seguridad.
      </p>
      <div className="field field--wide">
        <label htmlFor="cartera-file">Fichero Excel (.xlsx)</label>
        <input id="cartera-file" type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {done && <p className="notice">{done}</p>}

      {parsed && !done && (
        <>
          <p className="small">
            <strong>{fileName}</strong>: {parsed.operations.length} operaciones de {setup.length} valores.
            {parsed.warnings.length > 0 && <> {parsed.warnings.length} filas no se importan (abajo).</>}
          </p>

          {preview && 'error' in preview && <p className="error-box">{preview.error}</p>}
          {preview && !('error' in preview) && (
            <>
              {preview.ledger.issues.length > 0 && (
                <div className="error-box">
                  {preview.ledger.issues.map((i) => (
                    <p key={i.opId}>{`${i.ticker} ${i.date}: ${i.message}`}</p>
                  ))}
                </div>
              )}
              <table className="wl-table cartera-table import-compare">
                <thead>
                  <tr>
                    <th>Comprobación</th>
                    <th className="al-right">Web</th>
                    <th className="al-right">Excel</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Valores en cartera</td>
                    <td className="al-right num">{preview.open}</td>
                    <td />
                  </tr>
                  <tr>
                    <td>Dividendos y otros cobros</td>
                    <td className="al-right num">{money(preview.income, 'EUR', 2)}</td>
                    <td className="al-right num">{money(excelTotals?.incomeEur, 'EUR', 2)}</td>
                  </tr>
                  <tr>
                    <td title="Cada scrip va al lote de su columna «Lote», como en el Excel.">
                      P/G realizadas
                    </td>
                    <td className="al-right num">{money(preview.realized, 'EUR', 2)}</td>
                    <td className="al-right num">{money(excelTotals?.realizedEur, 'EUR', 2)}</td>
                  </tr>
                  <tr>
                    <td title="Esta cifra debe coincidir: no depende de cómo se reparta el scrip.">Realizadas − coste de lo que queda</td>
                    <td className="al-right num">{money(preview.realized - preview.openCost, 'EUR', 2)}</td>
                    <td className="al-right num">
                      {excelTotals?.realizedEur != null && excelOpenCost != null ? money(excelTotals.realizedEur - excelOpenCost, 'EUR', 2) : '–'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          <h3 className="renta__h">Valores: símbolo de Yahoo y bróker</h3>
          <p className="muted small">El símbolo sirve para el precio de hoy. El bróker se aplica a todas las operaciones del valor; luego se puede cambiar en el Registro.</p>
          <div className="table-wrap import-setup">
            <table className="wl-table cartera-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="al-right">Oper.</th>
                  <th>Símbolo Yahoo</th>
                  <th>Divisa</th>
                  <th>Bróker</th>
                  <th>Revisar</th>
                </tr>
              </thead>
              <tbody>
                {setup.map((s) => (
                  <tr key={s.ticker}>
                    <td className="ticker">{s.ticker}</td>
                    <td className="al-right num">{s.ops}</td>
                    <td>
                      <input className="cell-input" aria-label={`Símbolo de ${s.ticker}`} value={s.symbol} onChange={(e) => patch(s.ticker, { symbol: e.target.value })} />
                    </td>
                    <td>
                      <input className="cell-input cell-input--short" aria-label={`Divisa de ${s.ticker}`} value={s.currency} maxLength={3} onChange={(e) => patch(s.ticker, { currency: e.target.value.toUpperCase() })} />
                    </td>
                    <td>
                      <input className="cell-input" aria-label={`Bróker de ${s.ticker}`} list="import-brokers" value={s.broker} onChange={(e) => patch(s.ticker, { broker: e.target.value })} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`Revisar ${s.ticker}`} checked={s.review} onChange={(e) => patch(s.ticker, { review: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="import-brokers">
              <option value="ING" />
              <option value="MyInvestor" />
            </datalist>
          </div>
          {parsed.warnings.length > 0 && (
            <details className="small">
              <summary>Filas que no se importan ({parsed.warnings.length})</summary>
              <ul>
                {parsed.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Dialog>
  );
}
