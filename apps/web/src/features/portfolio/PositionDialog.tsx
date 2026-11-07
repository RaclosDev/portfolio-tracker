import { localToday, type PortfolioRow, type PositionInput } from '@watchlist/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/client.ts';
import { usePositionMutations } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { MINOR_CURRENCY, parseDecimal, pct, price, shortDate } from '../../lib/format.ts';
import { SymbolPicker } from '../items/SymbolPicker.tsx';

/** Datos con los que abrir el formulario de una posición nueva (p. ej. desde «Lo he comprado»). */
export type PositionDraft = Partial<Pick<PositionInput, 'symbol' | 'name' | 'shares' | 'avgPrice' | 'buyDate'>>;

interface Props {
  row: PortfolioRow | null;
  draft?: PositionDraft;
  base: string;
  onClose: () => void;
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
const understood = (raw: string, n: number | null) =>
  n == null || !/[.,]/.test(raw) ? '' : `= ${n.toLocaleString('es-ES', { maximumFractionDigits: 6 })}`;

/** Alta y edición de una posición de la cartera. */
export function PositionDialog({ row, draft, base, onClose }: Props) {
  const p = row?.position;
  const [symbol, setSymbol] = useState(p?.symbol ?? draft?.symbol ?? '');
  const [checked, setChecked] = useState(p?.symbol ?? draft?.symbol ?? '');
  const [name, setName] = useState(p?.name ?? draft?.name ?? '');
  const [shares, setShares] = useState(str(p?.shares ?? draft?.shares));
  const [avgPrice, setAvgPrice] = useState(str(p?.avgPrice ?? draft?.avgPrice));
  const [costBase, setCostBase] = useState(str(p?.costBase));
  const [buyDate, setBuyDate] = useState(p?.buyDate ?? draft?.buyDate ?? localToday());
  const [sellTarget, setSellTarget] = useState(str(p?.sellTarget));
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [muted, setMuted] = useState<string>(p?.mutedUntil ?? '');
  const [error, setError] = useState<string | null>(null);
  const { save, remove } = usePositionMutations();

  const quoteQ = useQuery({
    queryKey: ['quote', checked],
    queryFn: () => api.quote(checked),
    enabled: checked.length > 0,
    retry: false,
    staleTime: 60_000,
  });
  const quote = quoteQ.data;
  const currency = quote?.currency ?? row?.quote?.currency ?? null;
  const current = quote?.price ?? row?.quote?.price ?? null;
  const target = parseDecimal(sellTarget);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const data: PositionInput = {
      symbol: symbol.trim(),
      name: name.trim() || null,
      shares: parseDecimal(shares) ?? 0,
      avgPrice: parseDecimal(avgPrice) ?? 0,
      costBase: parseDecimal(costBase),
      buyDate: buyDate || null,
      sellTarget: target,
      notes: notes.trim() || null,
      mutedUntil: (muted || null) as PositionInput['mutedUntil'],
    };
    if (!data.symbol) return setError('Indica el símbolo.');
    if (!(data.shares > 0)) return setError('Indica cuántas acciones tienes.');
    if (!(data.avgPrice > 0)) return setError('Indica el precio medio de compra.');
    try {
      await save.mutateAsync({ id: p?.id, data });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.issues?.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message : 'No se pudo guardar',
      );
    }
  };

  const del = async () => {
    if (!p || !confirm(`¿Quitar ${p.name ?? p.symbol} de la cartera? Para registrar una venta usa «Vender».`)) return;
    await remove.mutateAsync(p.id);
    onClose();
  };

  return (
    <Dialog
      title={p ? `Editar ${p.name ?? p.symbol}` : 'Añadir posición'}
      onClose={onClose}
      wide
      footer={
        <>
          {p && (
            <button type="button" className="btn btn--danger-ghost" onClick={del} disabled={remove.isPending}>
              Quitar de la cartera
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="position-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="position-form" className="form" onSubmit={submit} noValidate>
        <fieldset className="form__section">
          <legend>Valor</legend>
          <div className="field field--wide">
            <label htmlFor="symbol">Símbolo (Yahoo Finance)</label>
            <SymbolPicker
              value={symbol}
              autoFocus={!p && !draft?.symbol}
              onChange={setSymbol}
              onPick={(r) => {
                setSymbol(r.symbol);
                setChecked(r.symbol);
                if (!name) setName(r.name);
              }}
            />
            <div className="field__help" aria-live="polite">
              {quoteQ.isFetching && 'Comprobando…'}
              {quoteQ.isError && <span className="error-text">No se encuentra este símbolo.</span>}
              {quote && (
                <>
                  {quote.name} · <strong>{price(quote.price)} {quote.currency}</strong>
                </>
              )}
              {!quoteQ.isFetching && !quote && !quoteQ.isError && symbol && symbol !== checked && (
                <button type="button" className="link" onClick={() => setChecked(symbol.trim().toUpperCase())}>
                  Comprobar símbolo
                </button>
              )}
            </div>
          </div>
          <div className="field field--wide">
            <label htmlFor="pos-name">Nombre (opcional)</label>
            <input id="pos-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Se toma del mercado si lo dejas vacío" />
          </div>
        </fieldset>

        <fieldset className="form__section">
          <legend>
            Lo que tienes {currency && <span className="muted">({currency})</span>}
            {currency && MINOR_CURRENCY[currency] && <span className="muted small"> · {MINOR_CURRENCY[currency]}, precios en peniques</span>}
          </legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="pos-shares">Acciones</label>
              <input id="pos-shares" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} />
              <span className="field__help">{understood(shares, parseDecimal(shares)) || ' '}</span>
            </div>
            <div className="field">
              <label htmlFor="pos-avg">Precio medio de compra</label>
              <input id="pos-avg" inputMode="decimal" value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} />
              <span className="field__help">{understood(avgPrice, parseDecimal(avgPrice)) || ' '}</span>
            </div>
            <div className="field">
              <label htmlFor="pos-date">Fecha de compra</label>
              <input id="pos-date" type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
            </div>
          </div>
          {currency && currency !== base && (
            <div className="field field--wide">
              <label htmlFor="pos-cost">Lo que pagaste en total ({base}, opcional)</label>
              <input id="pos-cost" inputMode="decimal" value={costBase} onChange={(e) => setCostBase(e.target.value)} />
              <span className="field__help">
                Con comisiones y al cambio de aquel día, como sale en el extracto del banco. Si lo dejas vacío, la plusvalía
                se calcula al cambio de hoy.
              </span>
            </div>
          )}
        </fieldset>

        <fieldset className="form__section">
          <legend>Venta</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="pos-target">Objetivo de venta</label>
              <input id="pos-target" inputMode="decimal" value={sellTarget} onChange={(e) => setSellTarget(e.target.value)} />
              <span className="field__help">
                {[understood(sellTarget, target), target && current ? `${pct((target - current) / current)} vs actual` : '']
                  .filter(Boolean)
                  .join(' · ') || 'Te aviso cuando el precio llegue o se acerque.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="pos-muted">Avisos de esta posición</label>
              <select
                id="pos-muted"
                className="select"
                value={muted === '' || muted === 'always' ? muted : 'fecha'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || v === 'always') return setMuted(v);
                  if (v === 'fecha') return;
                  const d = new Date();
                  d.setDate(d.getDate() + Number(v) - 1);
                  setMuted(localToday(d));
                }}
              >
                <option value="">Activados</option>
                <option value="7">Silenciar una semana</option>
                <option value="30">Silenciar un mes</option>
                <option value="always">Silenciar hasta que los vuelva a activar</option>
                {muted && muted !== 'always' && <option value="fecha">Silenciados hasta el {shortDate(muted)}</option>}
              </select>
            </div>
          </div>
        </fieldset>

        <div className="field field--wide">
          <label htmlFor="pos-notes">Notas</label>
          <textarea id="pos-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
