import {
  computeLedger, detectImportColumns, detectImportHeader, discoverImportInstruments, IMPORT_FIELDS,
  importMappingProblems, importOperationType, importOptionsSchema, instrumentInputSchema,
  normalizeImportText, operationFingerprint, OPERATION_LABELS, OPERATION_TYPES, previewImport,
  type CarteraView, type ImportField, type ImportInstrument, type ImportOptions, type OperationType,
} from '@watchlist/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOperationMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { readSpreadsheet, type ReadSheet } from '../../lib/excel.ts';
import { money, shortDate } from '../../lib/format.ts';
import { SymbolPicker } from '../items/SymbolPicker.tsx';

const fields = Object.keys(IMPORT_FIELDS) as ImportField[];
const PAGE_SIZE = 50;
const templateKey = (header: ReadSheet['data'][number]) => `portfolio-import-v1:${JSON.stringify(header.map(normalizeImportText))}`;
function initialOptions(header: ReadSheet['data'][number]): { options: ImportOptions; restored: boolean } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(templateKey(header)) ?? 'null');
    const saved = importOptionsSchema.safeParse(raw);
    if (saved.success && Object.values(saved.data.columns).every((i) => i < header.length)) return { options: saved.data, restored: true };
  } catch { /* El navegador puede impedir el almacenamiento local. */ }
  const columns = detectImportColumns(header);
  return { options: importOptionsSchema.parse({ columns, amountCurrency: columns.amount != null && /eur|€/i.test(String(header[columns.amount])) ? 'EUR' : undefined }), restored: false };
}

export function CarteraImportDialog({ view, onClose }: { view: CarteraView; onClose: () => void }) {
  const { importCartera } = useOperationMutations();
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<ReadSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [options, setOptions] = useState<ImportOptions>(() => importOptionsSchema.parse({ columns: {} }));
  const [restored, setRestored] = useState(false);
  const [remember, setRemember] = useState(true);
  const [step, setStep] = useState<'columns' | 'preview'>('columns');
  const [overrides, setOverrides] = useState<Record<string, Partial<ImportInstrument>>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const loadId = useRef(0);
  const stepLabel = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    stepLabel.current?.focus({ preventScroll: true });
    stepLabel.current?.scrollIntoView({ block: 'start' });
  }, [step]);
  const rows = sheets[sheetIndex]?.data ?? [];
  const header = rows[headerIndex] ?? [];
  const patch = (next: Partial<ImportOptions>) => { setOptions((o) => ({ ...o, ...next })); setConfirmed(false); };
  const configure = (sheet: ReadSheet, index: number) => {
    const detected = initialOptions(sheet.data[index] ?? []);
    setHeaderIndex(index); setOptions(detected.options); setRestored(detected.restored);
    setOverrides({}); setExcluded(new Set()); setAllowDuplicates(false); setConfirmed(false); setPage(0); setStep('columns');
  };
  const load = async (file: File) => {
    const requestId = ++loadId.current;
    setLoading(true); setError(null); setDone(null); setSheets([]);
    try {
      if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) throw new Error('Usa un archivo .xlsx, .csv o .tsv. Si tienes un .xls antiguo, guárdalo como .xlsx.');
      if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera 10 MB. Exporta un periodo más corto.');
      const loaded = (await readSpreadsheet(file)).filter((s) => s.data.some((r) => r.some((v) => v != null && String(v).trim())));
      if (requestId !== loadId.current) return;
      if (!loaded.length) throw new Error('El archivo está vacío.');
      if (loaded.some((s) => s.data.length > 20_050 || s.data.some((r) => r.length > 150))) throw new Error('Usa hojas de hasta 20.000 operaciones y 150 columnas.');
      const score = (s: ReadSheet) => Object.keys(detectImportColumns(s.data[detectImportHeader(s.data)] ?? [])).length;
      const best = loaded.reduce((a, s, i) => score(s) > score(loaded[a]!) ? i : a, 0);
      setSheets(loaded); setSheetIndex(best); setFileName(file.name); configure(loaded[best]!, detectImportHeader(loaded[best]!.data));
    } catch (err) { if (requestId === loadId.current) setError((err as Error).message); }
    finally { if (requestId === loadId.current) setLoading(false); }
  };
  const instruments = useMemo(() => discoverImportInstruments(rows.slice(headerIndex + 1), options, view.instruments)
    .map((i) => ({ ...i, ...overrides[i.key] })), [rows, headerIndex, options, view.instruments, overrides]);
  const changeInstrument = (key: string, change: Partial<ImportInstrument>) => {
    setOverrides((all) => ({ ...all, [key]: { ...all[key], ...change } })); setConfirmed(false);
  };
  const unknownTypes = useMemo(() => {
    if (options.columns.type == null) return [];
    const values = new Map<string, string>();
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.every((v) => v == null || String(v).trim() === '')) continue;
      const raw = row[options.columns.type];
      if (!importOperationType(raw, { ...options, typeMap: {} })) values.set(normalizeImportText(raw), String(raw ?? '').trim() || '(vacío)');
    }
    return [...values];
  }, [rows, headerIndex, options]);
  const mappingProblems = importMappingProblems(options);
  const unresolvedTypes = unknownTypes.filter(([key]) => !options.typeMap[key]);
  const preview = useMemo(() => previewImport(rows, headerIndex, options, instruments), [rows, headerIndex, options, instruments]);
  const reviewed = useMemo(() => {
    const seen = new Set(view.operations.map(operationFingerprint));
    return preview.map((row) => {
      const key = row.operation && operationFingerprint(row.operation);
      const duplicate = !!key && seen.has(key);
      const selected = !row.skipped && !excluded.has(row.line) && (!duplicate || allowDuplicates);
      if (key && selected) seen.add(key);
      return { ...row, duplicate, selected };
    });
  }, [preview, view.operations, excluded, allowDuplicates]);
  const additions = useMemo(() => reviewed.flatMap((r) => r.selected && r.operation ? [r.operation] : []), [reviewed]);
  const invalid = reviewed.filter((r) => r.selected && r.errors.length > 0).length;
  const duplicateCount = reviewed.filter((r) => r.duplicate).length;
  const ignored = reviewed.filter((r) => !r.selected).length;
  const activeTickers = new Set(additions.map((o) => o.ticker));
  const usedInstruments = [...new Map(instruments.filter((i) => activeTickers.has(i.ticker)).map((i) => [i.ticker, i])).values()];
  const instrumentProblems = usedInstruments.flatMap((i) => {
    const known = view.instruments.find((k) => k.ticker === i.ticker);
    if (known && (known.currency !== i.currency || (known.isin && i.isin && known.isin !== i.isin))) return [`${i.ticker}: la divisa o el ISIN no coincide con el valor guardado.`];
    if (instruments.some((other) => other.ticker === i.ticker && (other.currency !== i.currency || other.isin !== i.isin))) return [`${i.ticker}: has vinculado datos diferentes al mismo identificador.`];
    return [];
  });
  const combined = useMemo(() => {
    const firstId = view.operations.reduce((max, o) => Math.max(max, o.id), 0) + 1;
    return computeLedger([...view.operations, ...additions.map((o, i) => ({ ...o, id: firstId + i }))]);
  }, [view.operations, additions]);
  const issues = [...instrumentProblems, ...combined.issues.map((i) => `${i.ticker} · ${i.date}: ${i.message}`)];
  const ready = additions.length > 0 && additions.length <= 20_000 && usedInstruments.length <= 500 && invalid === 0 && issues.length === 0 && mappingProblems.length === 0 && confirmed;
  const busy = loading || importCartera.isPending;
  const pages = Math.max(1, Math.ceil(reviewed.length / PAGE_SIZE));
  const submit = async () => {
    if (!ready || busy) return;
    setError(null);
    try {
      const res = await importCartera.mutateAsync({ operations: additions, instruments: usedInstruments.map((i) => instrumentInputSchema.parse(i)), allowDuplicates });
      let storageNote = '';
      if (remember) {
        try { localStorage.setItem(templateKey(header), JSON.stringify(options)); }
        catch { storageNote = ' El navegador no ha permitido recordar el formato.'; }
      }
      const skipped = ignored + res.skipped;
      setDone(`Añadidas ${res.imported} operaciones. ${skipped} ${skipped === 1 ? 'fila omitida' : 'filas omitidas'}.${res.savedTo ? ' Se ha guardado una copia de la cartera anterior en Ajustes → Copias.' : ''}${storageNote}`);
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <Dialog title="Importar operaciones" onClose={() => { if (!busy) onClose(); }} wide className="dialog--xl portfolio-import"
      footer={<>
        {step === 'preview' && !done && <button className="btn" type="button" disabled={busy} onClick={() => { setStep('columns'); setConfirmed(false); }}>Volver a las columnas</button>}
        <span className="spacer" /><button className="btn" type="button" onClick={onClose} disabled={busy}>{done ? 'Cerrar' : 'Cancelar'}</button>
        {!done && sheets.length > 0 && (step === 'columns'
          ? <button className="btn btn--primary" type="button" disabled={busy || mappingProblems.length > 0 || unresolvedTypes.length > 0} onClick={() => { setStep('preview'); setPage(0); }}>Ver vista previa</button>
          : <button className="btn btn--primary" type="button" disabled={!ready || busy} onClick={() => void submit()}>{importCartera.isPending ? 'Añadiendo…' : `Añadir ${additions.length} operaciones`}</button>)}
      </>}>
      {error && <p className="error-box" role="alert">{error}</p>}
      {done ? <p className="notice" role="status">{done}</p> : <>
        <p className="muted">Sube el historial de operaciones de tu bróker. Revisa las columnas y los movimientos antes de añadirlos a tu cartera. Las operaciones guardadas se conservan.</p>
        <p className="small" ref={stepLabel} tabIndex={-1}>1. Archivo → {step === 'columns' ? <strong>2. Columnas</strong> : '2. Columnas'} → {step === 'preview' ? <strong>3. Vista previa</strong> : '3. Vista previa'}</p>
        {step === 'columns' && <>
          <div className="field field--wide"><label htmlFor="cartera-file">Archivo Excel o CSV</label>
            <input id="cartera-file" type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ''; }} />
            <span className="field__help">Una fila por operación ejecutada. Hasta 20.000 operaciones por hoja; no incluye órdenes pendientes ni extractos PDF.</span>
          </div>
          {loading && <p role="status">Leyendo el archivo…</p>}
          {sheets.length > 0 && <>
            <p className="small"><strong>{fileName}</strong>{restored ? ' · Formato recuperado de este navegador; revisa la correspondencia.' : ' · Columnas reconocidas por sus títulos; revisa las que falten.'}</p>
            <div className="grid-3">
              <div className="field"><label htmlFor="import-sheet">Hoja</label><select id="import-sheet" className="select" value={sheetIndex} onChange={(e) => { const i = Number(e.target.value); setSheetIndex(i); configure(sheets[i]!, detectImportHeader(sheets[i]!.data)); }}>{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></div>
              <div className="field"><label htmlFor="import-header">Fila de títulos</label><input id="import-header" type="number" min="1" max={rows.length} value={headerIndex + 1} onChange={(e) => { const i = Number(e.target.value) - 1; if (Number.isInteger(i) && i >= 0 && i < rows.length) configure(sheets[sheetIndex]!, i); }} /></div>
              <div className="field"><label htmlFor="import-broker">Bróker si no viene en el archivo</label><input id="import-broker" maxLength={40} value={options.defaultBroker} onChange={(e) => patch({ defaultBroker: e.target.value })} placeholder="Opcional" /></div>
            </div>
            <h3>Qué significa cada columna</h3>
            <p className="muted small">Los ejemplos son del archivo. Si hay varias fechas o importes posibles, elige la columna que corresponda a la operación.</p>
            <div className="import-mapping">{fields.map((field) => <div className="field" key={field}>
              <label htmlFor={`column-${field}`}>{IMPORT_FIELDS[field]}{field === 'date' ? ' *' : ''}</label>
              <select id={`column-${field}`} className="select" value={options.columns[field] ?? ''} onChange={(e) => {
                const columns = { ...options.columns }; if (e.target.value === '') delete columns[field]; else columns[field] = Number(e.target.value);
                patch({ columns, ...(field === 'type' ? { typeMap: {} } : {}) });
              }}><option value="">Sin asignar</option>{header.map((h, i) => <option key={i} value={i}>{i + 1}. {String(h ?? '(sin título)')}</option>)}</select>
              {options.columns[field] != null && <span className="field__help">Ej.: {rows.slice(headerIndex + 1, headerIndex + 4).map((r) => String(r[options.columns[field]!] ?? '—')).join(' · ')}</span>}
            </div>)}</div>
            <h3>Cómo interpretar los datos</h3><div className="grid-3">
              <div className="field"><label htmlFor="import-dates">Orden de las fechas</label><select id="import-dates" className="select" value={options.dateFormat} onChange={(e) => patch({ dateFormat: e.target.value as ImportOptions['dateFormat'] })}><option value="auto">Detectar y avisar si hay dudas</option><option value="dmy">Día / mes / año</option><option value="mdy">Mes / día / año</option></select></div>
              <div className="field"><label htmlFor="import-numbers">Separador decimal</label><select id="import-numbers" className="select" value={options.numberFormat} onChange={(e) => patch({ numberFormat: e.target.value as ImportOptions['numberFormat'] })}><option value="auto">Detectar y avisar si hay dudas</option><option value="comma">Coma: 1.234,56</option><option value="dot">Punto: 1,234.56</option></select></div>
              <div className="field"><label htmlFor="import-currency">Divisa si no viene en el archivo</label><input id="import-currency" maxLength={3} value={options.defaultCurrency} onChange={(e) => patch({ defaultCurrency: e.target.value.toUpperCase() })} /></div>
              {options.columns.type == null && <div className="field"><label htmlFor="import-type">Todas las filas son…</label><select id="import-type" className="select" value={options.defaultType ?? ''} onChange={(e) => patch({ defaultType: (e.target.value || undefined) as OperationType | undefined })}><option value="">Elige el tipo de operación</option>{OPERATION_TYPES.map((t) => <option key={t} value={t}>{OPERATION_LABELS[t]}</option>)}</select></div>}
              {options.columns.amount != null && <div className="field"><label htmlFor="import-amount-currency">La columna de importe está en… *</label><select id="import-amount-currency" className="select" value={options.amountCurrency ?? ''} onChange={(e) => patch({ amountCurrency: (e.target.value || undefined) as ImportOptions['amountCurrency'] })}><option value="">Indica la divisa del importe</option><option value="EUR">Euros</option><option value="instrument">La divisa de cada valor</option></select></div>}
            </div>
            <p className="muted small">Precio y comisiones van en la divisa del valor; retenciones, en euros. El cambio debe ser el histórico: unidades de esa divisa por 1 €. Si falta el importe de una compra o venta, se calcula con cantidad, precio y comisiones.</p>
            {options.columns.amount != null && <div className="import-checks">
              <label><input type="checkbox" checked={options.amountIncludesFees} onChange={(e) => patch({ amountIncludesFees: e.target.checked })} /> El importe de compras y ventas ya incluye las comisiones</label>
              <label><input type="checkbox" checked={options.incomeIsNet} onChange={(e) => patch({ incomeIsNet: e.target.checked })} /> Los dividendos y otros cobros son netos: sumar las retenciones y comisiones indicadas para obtener el bruto</label>
            </div>}
            {unknownTypes.length > 0 && <><h3>Tipos que necesitan aclaración</h3><div className="import-mapping">{unknownTypes.map(([key, label], i) => <div className="field" key={key}>
              <label htmlFor={`unknown-type-${i}`}>«{label}» significa…</label><select id={`unknown-type-${i}`} className="select" value={options.typeMap[key] ?? ''} onChange={(e) => {
                const typeMap = { ...options.typeMap }; if (e.target.value) typeMap[key] = e.target.value as OperationType | 'skip'; else delete typeMap[key]; patch({ typeMap });
              }}><option value="">Elige una interpretación</option>{OPERATION_TYPES.map((t) => <option key={t} value={t}>{OPERATION_LABELS[t]}</option>)}<option value="skip">No importar estas filas</option></select>
            </div>)}</div></>}
            {mappingProblems.length > 0 && <ul className="error-box">{mappingProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </>}
        </>}
        {step === 'preview' && <>
          <h3>Valores del archivo</h3>
          <p className="muted small">Revisa identificadores y divisas. Un ISIN puede servir de identificador. La cotización es opcional: deja el símbolo vacío si el valor no está en Yahoo; sus operaciones se guardarán igualmente.</p>
          <details className="import-instruments" open={instruments.some((i) => !i.ticker || i.problem)}><summary>Revisar {instruments.length === 1 ? 'el valor y su cotización' : `${instruments.length} valores y sus cotizaciones`}</summary>
            {instruments.map((i, index) => <fieldset key={i.key} className="import-instrument"><legend>{i.name || i.key}</legend><div className="grid-3">
              <div className="field"><label htmlFor={`existing-${index}`}>Vincular a un valor de mi cartera</label><select id={`existing-${index}`} className="select" value={view.instruments.some((k) => k.ticker === i.ticker) ? i.ticker : ''} onChange={(e) => {
                const known = view.instruments.find((k) => k.ticker === e.target.value);
                if (known) changeInstrument(i.key, known); else { setOverrides((all) => { const next = { ...all }; delete next[i.key]; return next; }); setConfirmed(false); }
              }}><option value="">Valor nuevo</option>{view.instruments.map((k) => <option key={k.ticker} value={k.ticker}>{k.name || k.ticker} · {k.ticker}</option>)}</select></div>
              <div className="field"><label htmlFor={`ticker-${index}`}>Identificador en la cartera</label><input id={`ticker-${index}`} value={i.ticker} maxLength={32} onChange={(e) => changeInstrument(i.key, { ticker: e.target.value.trim().toUpperCase() })} /></div>
              <div className="field"><label htmlFor={`currency-${index}`}>Divisa del valor</label><input id={`currency-${index}`} value={i.currency} maxLength={3} onChange={(e) => changeInstrument(i.key, { currency: e.target.value.toUpperCase() })} /></div>
            </div><div className="field field--wide"><label htmlFor={`quote-${index}`}>Cotización en Yahoo (opcional)</label><SymbolPicker inputId={`quote-${index}`} value={i.symbol ?? ''} onChange={(symbol) => changeInstrument(i.key, { symbol: symbol || null })} onPick={(result) => {
              const known = view.instruments.find((k) => k.symbol === result.symbol);
              changeInstrument(i.key, known ?? { symbol: result.symbol, ticker: i.ticker || result.symbol, name: i.name || result.name });
            }} /></div>{i.problem && <p className="error-box">{i.problem}</p>}</fieldset>)}
          </details>
          <h3>Operaciones que se añadirán</h3>
          <p role="status"><strong>{additions.length} listas</strong> · {invalid} con errores · {ignored} omitidas · {duplicateCount} posibles duplicadas</p>
          <p className="muted small">Los duplicados se comparan con tu cartera y con este archivo por fecha, valor, tipo, cantidad, importes y bróker. Revisa también operaciones que puedan venir expresadas de otra forma.</p>
          {duplicateCount > 0 && <label className="import-check"><input type="checkbox" checked={allowDuplicates} onChange={(e) => { setAllowDuplicates(e.target.checked); setConfirmed(false); }} /> Añadir también las coincidencias: confirmo que son operaciones distintas</label>}
          <p className="muted small import-scroll-hint">Desliza la tabla hacia los lados para ver importes y resultados.</p>
          <div className="import-preview" tabIndex={0} role="region" aria-label="Vista previa de operaciones"><table className="wl-table cartera-table"><thead><tr><th>Añadir</th><th>Fila</th><th>Fecha</th><th>Valor</th><th>Tipo</th><th>Cantidad</th><th>Precio</th><th>Importe (€)</th><th>Bróker</th><th>Resultado</th></tr></thead>
            <tbody>{reviewed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => <tr key={r.line} className={r.errors.length ? 'row--missing' : undefined}>
              <td><input type="checkbox" aria-label={`Añadir fila ${r.line}`} checked={r.selected} disabled={busy || r.skipped || (r.duplicate && !allowDuplicates)} onChange={(e) => {
                setExcluded((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(r.line); else next.add(r.line); return next; }); setConfirmed(false);
              }} /></td><td>{r.line}</td><td>{r.operation ? shortDate(r.operation.date) : '—'}</td><td>{r.operation?.ticker || r.label || 'Sin valor'}</td>
              <td>{r.operation ? OPERATION_LABELS[r.operation.type] : '—'}</td><td>{r.operation?.shares ?? '—'}</td><td>{r.operation?.price ?? '—'}</td>
              <td className="num">{r.operation ? money(r.operation.amountEur, 'EUR', 2) : '—'}</td><td>{r.operation?.broker || '—'}</td>
              <td className="import-row-result">{r.errors.length ? r.errors.join(' ') : r.skipped ? 'Tipo excluido' : r.duplicate ? 'Posible duplicada' : r.selected ? 'Se añadirá' : 'Excluida'}
                <details><summary>Ver detalle</summary>
                  {r.operation && <>
                    <strong>Operación interpretada</strong>
                    <div>Divisa: {usedInstruments.find((i) => i.ticker === r.operation?.ticker)?.currency ?? instruments.find((i) => i.ticker === r.operation?.ticker)?.currency}</div>
                    <div>Cambio por 1 €: {r.operation.fxRate}</div>
                    <div>Comisiones (divisa del valor): {r.operation.fees}</div>
                    <div>Retención España: {money(r.operation.withholdingEs ?? 0, 'EUR', 2)}</div>
                    <div>Retención origen: {money(r.operation.withholdingForeign ?? 0, 'EUR', 2)}</div>
                    {r.operation.splitRatio != null && <div>Ratio del split: {r.operation.splitRatio}</div>}
                  </>}
                  <strong>Datos del archivo</strong>{header.map((h, index) => <div key={index}><strong>{String(h ?? index + 1)}:</strong> {String(rows[r.line - 1]?.[index] ?? '—')}</div>)}
                </details>
              </td></tr>)}</tbody></table></div>
          <div className="row-actions import-pagination"><button type="button" className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button><span>Página {page + 1} de {pages} · {reviewed.length} filas</span><button type="button" className="btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div>
          {invalid > 0 && <p className="error-box">Corrige la interpretación en «Volver a las columnas» o desmarca las filas con errores. No se guardará ninguna operación hasta resolverlas.</p>}
          {issues.length > 0 && <div className="error-box" role="alert"><strong>La cartera resultante necesita revisión:</strong><ul>{issues.slice(0, 20).map((issue, i) => <li key={i}>{issue}</li>)}</ul>{issues.length > 20 && <p>Y {issues.length - 20} incidencias más.</p>}</div>}
          {(additions.length > 20_000 || usedInstruments.length > 500) && <p className="error-box">Divide el archivo: se admiten hasta 20.000 operaciones y 500 valores por importación.</p>}
          {additions.length > 0 && invalid === 0 && issues.length === 0 && <p>Tras añadirlas tendrás {combined.tickers.filter((t) => t.shares > 1e-9).length} valores con posición abierta.</p>}
          <div className="import-checks"><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /> He revisado los valores, las divisas y las operaciones de la vista previa</label>
            <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Recordar esta correspondencia de columnas en este navegador</label></div>
          <p className="muted small">Se guardará una copia de la cartera antes de añadir las operaciones. Si alguna deja la cartera descuadrada, se cancelará toda la importación.</p>
        </>}
      </>}
    </Dialog>
  );
}
