import type { ImportRow, Quote, WatchList } from '@watchlist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiError, api } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import type { ReadSheet } from '../../lib/excel.ts';
import { price, shortDate } from '../../lib/format.ts';
import { FIELD_LABEL, parseTable, symbolCandidates, type Field } from '../../lib/importTable.ts';

/** Sufijos de Yahoo para tickers que vienen sin mercado (como en el Excel con datos de Microsoft). */
const SUFFIXES = [
  { id: '', label: 'Dejarlos tal cual (EE. UU.)' },
  { id: '.MC', label: 'Bolsa de Madrid (.MC)' },
  { id: '.PA', label: 'París (.PA)' },
  { id: '.DE', label: 'Fráncfort Xetra (.DE)' },
  { id: '.AS', label: 'Ámsterdam (.AS)' },
  { id: '.MI', label: 'Milán (.MI)' },
  { id: '.L', label: 'Londres (.L)' },
];

interface Props {
  fileName: string;
  sheets: ReadSheet[];
  lists: WatchList[];
  defaultListId: number | null;
  /** Importe por defecto de Ajustes: si una fila trae ese mismo importe, no se fija (sigue al de Ajustes). */
  defaultInvest: number;
  onClose: () => void;
  onDone: (listId: number, message: string) => void;
}

const NEW_LIST = -1;

/** Ticker editable: se comprueba en Yahoo al salir del campo o con Enter (no en cada tecla). */
function SymbolCell({ label, initial, onCommit }: { label: string; initial: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  const commit = () => value.trim() && value.trim().toUpperCase() !== initial && onCommit(value);
  return (
    <input
      className="import-symbol"
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * Vista previa de la importación: qué columnas se han reconocido, a qué valor de Yahoo corresponde
 * cada ticker (se puede corregir) y a qué lista va. Nada se guarda hasta pulsar «Importar».
 */
export function ImportDialog({ fileName, sheets, lists, defaultListId, defaultInvest, onClose, onDone }: Props) {
  const parsedSheets = useMemo(() => sheets.map((s) => ({ ...s, table: parseTable(s.data) })), [sheets]);
  const firstValid = Math.max(0, parsedSheets.findIndex((s) => s.table?.rows.length));
  const [sheetIdx, setSheetIdx] = useState(firstValid);
  const sheet = parsedSheets[sheetIdx]!;
  const table = sheet.table;

  const sameName = lists.find((l) => l.name.toLowerCase() === sheet.name.toLowerCase());
  const [listId, setListId] = useState<number>(sameName?.id ?? defaultListId ?? lists[0]?.id ?? NEW_LIST);
  const [newName, setNewName] = useState(sheet.name);
  const bareCount = table?.rows.filter((r) => !/[.\s]/.test(r.symbol)).length ?? 0;
  const [suffix, setSuffix] = useState(bareCount ? '.MC' : '');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const rows = table?.rows ?? [];
  // Para cada fila, los símbolos a probar en orden: el editado, o el del fichero con el sufijo y sin él.
  const candidates = rows.map((r, i) => {
    const edited = edits[i]?.trim().toUpperCase();
    if (edited) return [edited.replace(/\s+/g, '')];
    return symbolCandidates(r.symbol, suffix);
  });
  const allSymbols = [...new Set(candidates.flat())].sort();
  const quotesQ = useQuery({
    queryKey: ['import-quotes', allSymbols.join(',')],
    queryFn: () => api.quotes(allSymbols),
    enabled: allSymbols.length > 0,
    staleTime: 5 * 60_000,
  });
  const found = new Map<string, Quote>((quotesQ.data ?? []).map((q) => [q.symbol, q]));
  const resolved = candidates.map((c) => c.find((s) => found.has(s)) ?? null);
  const missing = quotesQ.data ? resolved.filter((s) => !s).length : 0;
  const ready = rows.length > 0 && !quotesQ.isFetching && !!quotesQ.data;
  const toImport: ImportRow[] = rows.flatMap((r, i) => {
    if (!resolved[i]) return [];
    const { investAmount, ...rest } = r;
    return [{ ...rest, symbol: resolved[i]!, ...(investAmount != null && investAmount !== defaultInvest ? { investAmount } : {}) }];
  });

  const recognized = table ? (Object.keys(table.columns) as Field[]).map((f) => FIELD_LABEL[f]) : [];

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      let target = listId;
      if (target === NEW_LIST) {
        if (!newName.trim()) throw new Error('Pon un nombre a la lista nueva.');
        target = (await api.createList(newName.trim())).id;
      }
      const res = await api.importRows(target, toImport);
      await qc.invalidateQueries();
      onDone(
        target,
        `Importados ${res.created + res.updated} valores: ${res.created} nuevos y ${res.updated} actualizados.` +
          (missing ? ` ${missing} no se importaron porque no se encuentran en Yahoo.` : ''),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.issues?.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Importar desde Excel o CSV"
      onClose={onClose}
      wide
      className="import-dialog"
      footer={
        <>
          <span className="muted small">
            {ready && `${toImport.length} de ${rows.length} valores listos`}
            {quotesQ.isFetching && 'Comprobando los tickers en Yahoo…'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!ready || !toImport.length || busy}>
            {busy ? 'Importando…' : `Importar ${toImport.length || ''}`.trim()}
          </button>
        </>
      }
    >
      <p className="muted small">
        {fileName}. Si un valor ya está en la lista, solo se cambian los datos que trae el fichero; lo demás (notas, avisos…)
        se mantiene.
      </p>

      <div className="grid-3">
        {parsedSheets.length > 1 && (
          <div className="field">
            <label htmlFor="imp-sheet">Hoja</label>
            <select
              id="imp-sheet"
              className="select"
              value={sheetIdx}
              onChange={(e) => {
                setSheetIdx(Number(e.target.value));
                setEdits({});
              }}
            >
              {parsedSheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} {s.table ? `(${s.table.rows.length})` : '(sin columna de ticker)'}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="imp-list">Añadir a la lista</label>
          <select id="imp-list" className="select" value={listId} onChange={(e) => setListId(Number(e.target.value))}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value={NEW_LIST}>Lista nueva…</option>
          </select>
        </div>
        {listId === NEW_LIST && (
          <div className="field">
            <label htmlFor="imp-newlist">Nombre de la lista nueva</label>
            <input id="imp-newlist" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
        )}
        {bareCount > 0 && (
          <div className="field">
            <label htmlFor="imp-suffix">Tickers sin mercado ({bareCount})</label>
            <select id="imp-suffix" className="select" value={suffix} onChange={(e) => setSuffix(e.target.value)}>
              {SUFFIXES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="field__help">Si no existe en ese mercado, se usa tal cual.</span>
          </div>
        )}
      </div>

      {!table ? (
        <p className="error-box">
          No encuentro una columna «Ticker» (o «Símbolo») en esta hoja. Es la única obligatoria: el resto de columnas se
          reconocen por su título (Compra 1, P.O. R4, Invertir, Hasta, Notas…).
        </p>
      ) : (
        <>
          <p className="small">
            <strong>Columnas reconocidas:</strong> {recognized.join(', ')}.
            {table.skipped > 0 && <span className="muted"> {table.skipped} filas sin ticker o repetidas se ignoran.</span>}
          </p>
          {missing > 0 && (
            <p className="notice" role="status">
              {missing === 1 ? '1 ticker no se encuentra' : `${missing} tickers no se encuentran`} en Yahoo. Corrígelos en la
              tabla (p. ej. ITX.MC) o se quedarán fuera.
            </p>
          )}
          <div className="table-wrap import-preview">
            <table className="wl-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>En Yahoo</th>
                  <th className="al-right">Compras</th>
                  <th className="al-right">Objetivo</th>
                  <th className="al-right">Invertir</th>
                  <th>Orden</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const sym = resolved[i];
                  const q = sym ? found.get(sym) : undefined;
                  return (
                    <tr key={i} className={`row${quotesQ.data && !sym ? ' row--missing' : ''}`}>
                      <td>
                        <SymbolCell
                          key={sym ?? r.symbol}
                          label={`Ticker de la fila ${i + 1}`}
                          initial={edits[i] ?? sym ?? r.symbol}
                          onCommit={(v) => setEdits((x) => ({ ...x, [i]: v }))}
                        />
                      </td>
                      <td>
                        {q ? (
                          <span className="stack">
                            <span>{q.name ?? q.symbol}</span>
                            <span className="sub">
                              {q.exchange} · {price(q.price)} {q.currency}
                            </span>
                          </span>
                        ) : quotesQ.isFetching ? (
                          <span className="muted">…</span>
                        ) : (
                          <span className="error-text">No encontrado</span>
                        )}
                      </td>
                      <td className="al-right num">{r.buyPrices?.map((p) => price(p, q?.currency)).join(' · ') ?? '–'}</td>
                      <td className="al-right num">{r.brokerTarget ? price(r.brokerTarget, q?.currency) : '–'}</td>
                      <td className="al-right num">{r.investAmount ?? '–'}</td>
                      <td>{r.orderActive ? `Sí${r.orderUntil ? `, hasta ${shortDate(r.orderUntil)}` : ''}` : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
