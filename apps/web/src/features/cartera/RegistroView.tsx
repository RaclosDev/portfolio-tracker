import { KNOWN_BROKERS, OPERATION_LABELS, OPERATION_TYPES, type Operation, type OperationType } from '@watchlist/shared';
import { useMemo, useState } from 'react';
import { useOperationMutations } from '../../api/hooks.ts';
import { money, num, price, shortDate } from '../../lib/format.ts';
import type { CarteraModel } from './model.ts';

const PAGE = 200;

/** «Registro»: todas las operaciones, con filtros y cambio de bróker de varias a la vez. */
export function RegistroView({
  model,
  onEdit,
}: {
  model: CarteraModel;
  onEdit: (op: Operation) => void;
}) {
  const ops = model.view.operations;
  const [q, setQ] = useState('');
  const [type, setType] = useState<OperationType | ''>('');
  const [broker, setBroker] = useState('');
  const [year, setYear] = useState('');
  const [review, setReview] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [newBroker, setNewBroker] = useState('');
  const { setBroker: bulk } = useOperationMutations();

  const years = useMemo(() => [...new Set(ops.map((o) => o.date.slice(0, 4)))].sort().reverse(), [ops]);
  /** Divisa de cada valor, para rotular su precio por acción. */
  const currencies = useMemo(() => {
    const m = new Map<string, string>(model.view.instruments.map((i) => [i.ticker, i.currency]));
    for (const r of [...model.valuation.open, ...model.valuation.closed]) m.set(r.ticker, r.currency);
    return m;
  }, [model.view.instruments, model.valuation]);
  const issues = useMemo(() => new Map(model.ledger.issues.map((i) => [i.opId, i.message])), [model.ledger.issues]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...ops]
      .filter(
        (o) =>
          (!needle ||
            o.ticker.toLowerCase().includes(needle) ||
            (model.names.get(o.ticker) ?? '').toLowerCase().includes(needle) ||
            (o.notes ?? '').toLowerCase().includes(needle)) &&
          (!type || o.type === type) &&
          (!broker || (broker === '-' ? !o.broker : o.broker === broker)) &&
          (!year || o.date.startsWith(year)) &&
          (!review || o.needsReview),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }, [ops, q, type, broker, year, review, model.names]);
  const reviewCount = ops.filter((o) => o.needsReview).length;
  const allSelected = filtered.length > 0 && filtered.every((o) => selected.has(o.id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const applyBroker = async () => {
    await bulk.mutateAsync({ ids: [...selected], broker: newBroker.trim() || null, needsReview: false });
    setSelected(new Set());
  };

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Buscar ticker, nombre o nota"
          aria-label="Buscar en el registro"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value as OperationType | '')}>
          <option value="">Todos los tipos</option>
          {OPERATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {OPERATION_LABELS[t]}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Bróker" value={broker} onChange={(e) => setBroker(e.target.value)}>
          <option value="">Todos los brókers</option>
          {model.brokers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value="-">Sin bróker</option>
        </select>
        <select className="select" aria-label="Año" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Todos los años</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {reviewCount > 0 && (
          <label className="check" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Por revisar ({reviewCount})
          </label>
        )}
      </div>

      {selected.size > 0 && (
        <div className="toolbar bulkbar" role="region" aria-label="Operaciones seleccionadas">
          <strong>{selected.size} seleccionadas</strong>
          <label htmlFor="bulk-broker">Cambiar bróker a</label>
          <input id="bulk-broker" className="search" style={{ width: 160 }} list="bulk-brokers" value={newBroker} onChange={(e) => setNewBroker(e.target.value)} />
          <datalist id="bulk-brokers">
            {[...new Set([...KNOWN_BROKERS, ...model.brokers])].map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <button type="button" className="btn btn--primary" onClick={() => void applyBroker()} disabled={bulk.isPending}>
            Aplicar
          </button>
          <button type="button" className="btn" onClick={() => setSelected(new Set())}>
            Quitar selección
          </button>
        </div>
      )}

      <p className="muted small">
        {filtered.length === ops.length ? `${ops.length} operaciones` : `${filtered.length} de ${ops.length} operaciones`}. Pulsa
        una fila para editarla.
      </p>
      <div className="table-wrap">
        <table className="wl-table cartera-table registro-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas las filtradas"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((o) => o.id)))}
                />
              </th>
              <th>Fecha</th>
              <th>Valor</th>
              <th>Tipo</th>
              <th className="al-right">Acciones</th>
              <th className="al-right">Precio</th>
              <th className="al-right">Importe €</th>
              <th className="al-right" title="Retención en España / en origen">
                Retenciones
              </th>
              <th>Bróker</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((o) => (
              <tr key={o.id} className={`row row--click${issues.has(o.id) ? ' row--issue' : ''}`} onClick={() => onEdit(o)}>
                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Seleccionar ${o.ticker} ${o.date}`} checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                </td>
                <td className="num">{shortDate(o.date)}</td>
                <td>
                  <div className="stack">
                    <span className="ticker">{o.ticker}</span>
                    <span className="sub">{model.names.get(o.ticker) !== o.ticker ? model.names.get(o.ticker) : ''}</span>
                  </div>
                </td>
                <td>
                  <span className={`optype optype--${o.type}`}>{OPERATION_LABELS[o.type]}</span>
                  {o.type === 'split' && <span className="sub"> ×{num(o.splitRatio, 2)}</span>}
                </td>
                <td className="al-right num">{o.shares ? num(o.shares, Number.isInteger(o.shares) ? 0 : 3) : ''}</td>
                <td className="al-right num">{o.price ? price(o.price, currencies.get(o.ticker) ?? 'EUR') : ''}</td>
                <td className="al-right num">{o.amountEur ? money(o.amountEur, 'EUR', 2) : o.fees ? `−${money(o.fees, 'EUR', 2)}` : ''}</td>
                <td className="al-right num small">
                  {[o.withholdingEs, o.withholdingForeign].some((v) => v != null)
                    ? `${money(o.withholdingEs, 'EUR', 2)} / ${money(o.withholdingForeign, 'EUR', 2)}`
                    : ''}
                </td>
                <td>
                  {o.broker ?? <span className="muted">–</span>}
                  {o.needsReview && (
                    <span className="badge badge--danger" title="Marcada para revisar">
                      revisar
                    </span>
                  )}
                </td>
                <td>
                  <span className="notes" title={issues.get(o.id) ?? o.notes ?? undefined}>
                    {issues.get(o.id) ?? o.notes}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <p className="center">
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Ver más ({filtered.length - limit} restantes)
          </button>
        </p>
      )}
    </>
  );
}
