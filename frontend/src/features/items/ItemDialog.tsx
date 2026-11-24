import { displayTicker, isinInSymbol, itemInputSchema, localToday, tickerFromSymbol, MAX_BUY_LEVELS, roundUpShares, type ItemInput, type Settings, type WatchlistRow } from '@/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api/client.ts';
import { useDeleteItem, useSaveItem } from '../../api/hooks.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { toast } from '../../components/feedback.tsx';
import { DateField } from '../../components/DateField.tsx';
import { MINOR_CURRENCY, money, num, parseDecimal, pct, price, shortDate } from '../../lib/format.ts';
import type { OperationDraft } from '../cartera/OperationDialog.tsx';
import { SymbolPicker } from './SymbolPicker.tsx';
import { boughtDraft } from './boughtDraft.ts';

interface Props {
  listId: number;
  row: WatchlistRow | null; // null = nuevo
  settings: Settings;
  fx: Record<string, number>;
  onClose: () => void;
  /** «Lo he comprado»: abre el alta en la cartera con los datos de la compra prevista. */
  onBought?: (draft: OperationDraft) => void;
  /** Alta desde el buscador de la cabecera: el valor ya viene elegido. */
  prefill?: { symbol: string; name?: string | null; isin?: string | null };
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

/**
 * Cuando el número escrito lleva punto o coma, muestra cómo se ha entendido ("1.234" puede
 * ser mil doscientos o uno coma dos). Así se ve antes de guardar.
 */
function understood(raw: string, n: number | null) {
  if (n == null || !/[.,]/.test(raw)) return '';
  // «64,2» se lee igual: solo se aclara cuando hay puntos o más de una coma.
  if (/^\d+(,\d+)?$/.test(raw.trim())) return '';
  return `= ${n.toLocaleString('es-ES', { maximumFractionDigits: 6, useGrouping: 'always' as unknown as boolean })}`;
}

const joinHelp = (...parts: string[]) => parts.filter(Boolean).join(' · ') || ' ';

export function ItemDialog({ listId, row, settings, fx, onClose, onBought, prefill }: Props) {
  const item = row?.item;
  const [symbol, setSymbol] = useState(item?.symbol ?? prefill?.symbol ?? '');
  const [checkedSymbol, setCheckedSymbol] = useState(item?.symbol ?? prefill?.symbol ?? '');
  const [ticker, setTicker] = useState(item ? displayTicker(item) : '');
  const [isin, setIsin] = useState(item?.isin ?? prefill?.isin ?? '');
  const [name, setName] = useState(item?.name ?? prefill?.name ?? '');
  const [levels, setLevels] = useState<string[]>(
    Array.from({ length: MAX_BUY_LEVELS }, (_, i) => str(item?.buyPrices[i])),
  );
  const [brokerTarget, setBrokerTarget] = useState(str(item?.brokerTarget));
  const [brokerName, setBrokerName] = useState(item?.brokerName ?? 'Renta 4');
  const [invest, setInvest] = useState(str(item?.investAmount));
  const [shares, setShares] = useState(str(item?.sharesOverride));
  const [orderActive, setOrderActive] = useState(item?.orderActive ?? false);
  const [orderPrice, setOrderPrice] = useState(str(item?.orderPrice));
  const [orderUntil, setOrderUntil] = useState(item?.orderUntil ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  /** '' = avisos activados · 'always' · o una fecha AAAA-MM-DD hasta la que se silencian */
  const [muted, setMuted] = useState<string>(item?.mutedUntil ?? '');
  const [error, setError] = useState<string | null>(null);
  /** Al editar: muestra el buscador y los campos de identificación en vez del resumen. */
  const [changingId, setChangingId] = useState(false);
  // Hay cambios sin guardar si el formulario difiere de como se abrió (para no perderlos al cerrar sin querer).
  const formState = JSON.stringify([symbol, ticker, isin, name, levels, brokerTarget, brokerName, invest, shares, orderActive, orderPrice, orderUntil, notes, muted]);
  const [initialForm] = useState(formState);
  const dirty = formState !== initialForm;

  const qc = useQueryClient();
  const save = useSaveItem();
  const del = useDeleteItem();

  const quoteQ = useQuery({
    queryKey: ['quote', checkedSymbol],
    queryFn: () => api.quote(checkedSymbol),
    enabled: checkedSymbol.length > 0,
    retry: false,
    staleTime: 60_000,
  });
  const quote = quoteQ.data;
  const current = quote?.price ?? null;
  const currency = quote?.currency ?? null;
  // Si la divisa no está aún en la lista (p. ej. el primer valor en libras), se pide su tipo de cambio.
  const needsFx = !!currency && currency !== settings.baseCurrency && fx[currency] == null;
  const fxQ = useQuery({
    queryKey: ['fx', currency],
    queryFn: () => api.fx([currency!]),
    enabled: needsFx,
    staleTime: 5 * 60_000,
  });
  const fxRate = !currency
    ? undefined
    : currency === settings.baseCurrency
      ? 1
      : (fx[currency] ?? fxQ.data?.[currency]);

  // Vista previa del cálculo de acciones, igual que en la tabla.
  const investN = parseDecimal(invest) ?? settings.defaultInvest;
  const entry = (orderActive ? parseDecimal(orderPrice) : null) ?? parseDecimal(levels[0] ?? '');
  const sharesCalc = entry && fxRate ? (investN * fxRate) / entry : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const buyPrices = levels.map(parseDecimal).filter((v): v is number => v != null && v > 0);
    const data: ItemInput = {
      listId,
      symbol: symbol.trim(),
      ticker: ticker.trim() || (symbol.trim() ? tickerFromSymbol(symbol) : null),
      isin: isin.trim() || quote?.isin || isinInSymbol(symbol) || null,
      name: name.trim() || null,
      buyPrices,
      brokerTarget: parseDecimal(brokerTarget),
      brokerName: brokerTarget.trim() ? brokerName.trim() || null : null,
      investAmount: parseDecimal(invest),
      sharesOverride: shares.trim() ? Math.round(parseDecimal(shares) ?? 0) || null : null,
      orderActive,
      orderPrice: orderActive ? (parseDecimal(orderPrice) ?? buyPrices[0] ?? null) : null,
      orderUntil: orderActive && orderUntil ? orderUntil : null,
      notes: notes.trim() || null,
      mutedUntil: (muted || null) as ItemInput['mutedUntil'],
    };
    if (!data.symbol) return setError('Busca y elige el valor.');
    // Al editar se envían solo los campos cambiados: si otra persona tocó el valor mientras esta ventana
    // estaba abierta (p. ej. quitó la orden), sus cambios no se pisan con los datos viejos de aquí.
    const payload = item
      ? Object.fromEntries(
          Object.entries(data).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(item[k as keyof typeof item] ?? null)),
        )
      : data;
    if (item && !Object.keys(payload).length) return onClose();
    try {
      await save.mutateAsync({ id: item?.id, data: payload });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.issues?.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message
          : 'No se pudo guardar',
      );
    }
  };

  // Se quita al momento y el aviso ofrece «Deshacer» (vuelve a crearlo con los mismos datos), en vez de preguntar antes.
  const remove = async () => {
    if (!item) return;
    try {
      await del.mutateAsync(item.id);
    } catch (err) {
      return setError(err instanceof Error ? err.message : 'No se pudo quitar');
    }
    onClose();
    const label = item.name ?? item.symbol;
    toast(`${label} quitado de la lista.`, {
      action: {
        label: 'Deshacer',
        onClick: async () => {
          await api.createItem(itemInputSchema.parse(item));
          await qc.invalidateQueries();
          toast(`${label} recuperado.`);
        },
      },
    });
  };

  return (
    <Dialog
      title={item ? `Editar ${item.name ?? item.symbol}` : 'Añadir valor'}
      onClose={onClose}
      dirty={dirty}
      wide
      footer={
        <>
          {item && (
            <button type="button" className="btn btn--danger-ghost" onClick={remove} disabled={del.isPending}>
              Quitar de la lista
            </button>
          )}
          {item && onBought && (
            <button
              type="button"
              className="btn"
              title="Pasar este valor a la cartera con la compra prevista"
              onClick={() => row && onBought(boughtDraft(row, quote?.isin))}
            >
              Lo he comprado
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="item-form" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id="item-form" className="form" onSubmit={submit} noValidate>
        {/* Al editar, el valor se resume en una línea; buscar otro o tocar ticker, ISIN y nombre queda a un clic. */}
        <fieldset className="form__section">
          <legend className="sr-only">Valor</legend>
          {item && !changingId ? (
            <div className="item-id">
              <div className="item-id__text">
                <strong>{name.trim() || quote?.name || item.symbol}</strong>
                <span className="muted">
                  {[ticker || displayTicker(item), isin, quote?.exchange, quote?.price != null ? `${price(quote.price)} ${quote.currency ?? ''}`.trim() : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button type="button" className="btn btn--small" onClick={() => setChangingId(true)}>
                Cambiar
              </button>
            </div>
          ) : (
          <>
          <div className="field field--wide">
            <label htmlFor="symbol">Buscar el valor (nombre, ISIN o ticker)</label>
            <SymbolPicker
              value={symbol}
              autoFocus={!item || changingId}
              onChange={setSymbol}
              onPick={(r) => {
                setSymbol(r.symbol);
                setCheckedSymbol(r.symbol);
                setTicker(tickerFromSymbol(r.symbol));
                setIsin(r.isin ?? isinInSymbol(r.symbol) ?? '');
                if (!name || name === item?.name) setName(r.name);
              }}
            />
            <div className="field__help" aria-live="polite">
              {quoteQ.isFetching && 'Comprobando…'}
              {quoteQ.isError && <span className="error-text">No se encuentra su cotización.</span>}
              {quote && (
                <>
                  {quote.name} · <strong>{price(quote.price)} {quote.currency}</strong>
                  {quote.exchange && ` · ${quote.exchange}`}
                </>
              )}
              {!quoteQ.isFetching && !quote && !quoteQ.isError && symbol && symbol !== checkedSymbol && (
                <button type="button" className="link" onClick={() => setCheckedSymbol(symbol.trim().toUpperCase())}>
                  Comprobar cotización
                </button>
              )}
            </div>
          </div>
          <details className="item-id__more" open={!!item}>
            <summary>Ticker, ISIN y nombre</summary>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="item-ticker">Ticker</label>
                <input id="item-ticker" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder={symbol ? tickerFromSymbol(symbol) : 'Automático'} />
              </div>
              <div className="field">
                <label htmlFor="item-isin">ISIN</label>
                <input id="item-isin" value={isin} onChange={(e) => setIsin(e.target.value.toUpperCase())} placeholder={quote?.isin ?? isinInSymbol(symbol) ?? 'Automático'} maxLength={12} />
              </div>
              <div className="field">
                <label htmlFor="name">Nombre</label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={quote?.name ?? 'El del mercado'} />
              </div>
            </div>
          </details>
          </>
          )}
        </fieldset>

        <fieldset className="form__section">
          <legend>
            Precios de compra {currency && <span className="muted">({currency})</span>}
            {currency && MINOR_CURRENCY[currency] && (
              <span className="muted small"> · {MINOR_CURRENCY[currency]}, introduce los precios en peniques</span>
            )}
          </legend>
          <div className="grid-3">
            {levels.map((v, i) => {
              const n = parseDecimal(v);
              return (
                <div className="field" key={i}>
                  <label htmlFor={`lvl${i}`}>Compra {i + 1}</label>
                  <input
                    id={`lvl${i}`}
                    inputMode="decimal"
                    value={v}
                    onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <span className="field__help">{joinHelp(understood(v, n), n && current ? `${pct((n - current) / current)} vs actual` : '')}</span>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className={`form__section${orderActive ? ' form__section--order' : ''}`}>
          <legend>Orden en el banco</legend>
          <label className="check">
            <input type="checkbox" checked={orderActive} onChange={(e) => setOrderActive(e.target.checked)} />
            Tengo una orden puesta
          </label>
          {orderActive && (
            <div className="grid-3">
              <div className="field">
                <label htmlFor="op">Precio límite</label>
                <input id="op" inputMode="decimal" value={orderPrice} placeholder={levels[0]} onChange={(e) => setOrderPrice(e.target.value)} />
                <span className="field__help">{joinHelp(understood(orderPrice, parseDecimal(orderPrice)))}</span>
              </div>
              <div className="field">
                <label htmlFor="ou">Válida hasta</label>
                <DateField id="ou" clearable value={orderUntil} onChange={setOrderUntil} />
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="form__section">
          <legend>Objetivo del bróker</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="bt">Precio objetivo</label>
              <input id="bt" inputMode="decimal" value={brokerTarget} onChange={(e) => setBrokerTarget(e.target.value)} />
              <span className="field__help">
                {joinHelp(understood(brokerTarget, parseDecimal(brokerTarget)), parseDecimal(brokerTarget) && current ? `${pct((parseDecimal(brokerTarget)! - current) / current)} potencial` : '')}
              </span>
            </div>
            <div className="field">
              <label htmlFor="bn">Bróker</label>
              <input id="bn" value={brokerName} onChange={(e) => setBrokerName(e.target.value)} />
            </div>
            {/* El consenso no se edita: se queda como referencia junto al objetivo. */}
            {row?.targets?.mean != null && (
              <div className="field field--readonly">
                <span className="label">Consenso · {row.targets.analysts ?? '?'} analistas</span>
                <span className="field__value">{price(Math.round(row.targets.mean * 100) / 100, row.quote?.currency)}</span>
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="form__section">
          <legend>Compra prevista</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="inv">Importe ({settings.baseCurrency})</label>
              <input id="inv" inputMode="decimal" value={invest} placeholder={num(settings.defaultInvest)} onChange={(e) => setInvest(e.target.value)} />
              <span className="field__help">{joinHelp(understood(invest, parseDecimal(invest)))}</span>
            </div>
            <div className="field">
              <label htmlFor="sh">Acciones</label>
              <input
                id="sh"
                inputMode="numeric"
                value={shares}
                placeholder={sharesCalc != null ? num(roundUpShares(sharesCalc)) : ''}
                onChange={(e) => setShares(e.target.value)}
              />
              <span className="field__help">
                {sharesCalc != null ? (shares.trim() ? `Automático: ${num(sharesCalc, 2)}` : `Automático (${num(sharesCalc, 2)})`) : ' '}
              </span>
            </div>
            <div className="field field--readonly">
              <span className="label">Total</span>
              <span className="field__value">
                {entry && fxRate
                  ? money(((parseDecimal(shares) ?? (sharesCalc != null ? roundUpShares(sharesCalc) : 0)) * entry) / fxRate, settings.baseCurrency)
                  : '–'}
              </span>
            </div>
          </div>
        </fieldset>

        <div className="field field--wide">
          <label htmlFor="notes">Notas</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="field field--wide">
          <label htmlFor="muted">Avisos</label>
          <select
            id="muted"
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
            <option value="1">Silenciar hoy</option>
            <option value="7">Silenciar una semana</option>
            <option value="30">Silenciar un mes</option>
            <option value="always">Silenciar hasta que los vuelva a activar</option>
            {muted && muted !== 'always' && <option value="fecha">Silenciados hasta el {shortDate(muted)}</option>}
          </select>
          <span className="field__help">Silenciar solo quita las notificaciones; el valor sigue en la lista.</span>
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
