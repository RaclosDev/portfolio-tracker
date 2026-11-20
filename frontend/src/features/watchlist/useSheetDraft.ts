import { MAX_BUY_LEVELS, type ItemPatch, type WatchlistRow } from '@/shared';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { useSaveItem } from '../../api/hooks.ts';
import { toast } from '../../components/feedback.tsx';
import { parseDecimal } from '../../lib/format.ts';

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

export interface SheetDraft {
  levels: string[];
  orderActive: boolean;
  orderPrice: string;
  orderUntil: string;
  brokerTarget: string;
  brokerName: string;
  invest: string;
  shares: string;
  notes: string;
}

/**
 * Borrador de la ficha en modo edición: los campos se editan donde se ven y al guardar solo se
 * envía lo que ha cambiado. Se crea al montar, así que la ficha se monta de nuevo al entrar a editar.
 */
export function useSheetDraft(row: WatchlistRow, onDone: () => void) {
  const { item } = row;
  const [d, setD] = useState<SheetDraft>(() => ({
    levels: Array.from({ length: MAX_BUY_LEVELS }, (_, i) => str(item.buyPrices[i])),
    orderActive: item.orderActive,
    orderPrice: str(item.orderPrice),
    orderUntil: item.orderUntil ?? '',
    brokerTarget: str(item.brokerTarget),
    brokerName: item.brokerName ?? '',
    invest: str(item.investAmount),
    shares: str(item.sharesOverride),
    notes: item.notes ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveItem();

  const set = <K extends keyof SheetDraft>(k: K, v: SheetDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setLevel = (i: number, v: string) => setD((p) => ({ ...p, levels: p.levels.map((x, j) => (j === i ? v : x)) }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const bad = [...d.levels, d.orderPrice, d.brokerTarget, d.invest, d.shares].find((v) => v.trim() && !(parseDecimal(v)! > 0));
    if (bad != null) return setError(`«${bad}» no es un número válido.`);
    const buyPrices = d.levels.map(parseDecimal).filter((v): v is number => v != null && v > 0);
    const data: ItemPatch = {
      buyPrices,
      orderActive: d.orderActive,
      orderPrice: d.orderActive ? (parseDecimal(d.orderPrice) ?? buyPrices[0] ?? null) : null,
      orderUntil: d.orderActive && d.orderUntil ? d.orderUntil : null,
      brokerTarget: parseDecimal(d.brokerTarget),
      brokerName: d.brokerTarget.trim() ? d.brokerName.trim() || null : null,
      investAmount: parseDecimal(d.invest),
      sharesOverride: d.shares.trim() ? Math.round(parseDecimal(d.shares) ?? 0) || null : null,
      notes: d.notes.trim() || null,
    };
    const patch = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(item[k as keyof typeof item] ?? null)),
    );
    if (!Object.keys(patch).length) return onDone();
    try {
      await save.mutateAsync({ id: item.id, data: patch });
      toast(`${item.name ?? item.symbol}: cambios guardados.`);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.issues?.map((i) => `${i.path}: ${i.message}`).join(' · ') || err.message
          : 'No se pudo guardar',
      );
    }
  };

  // Esc cancela y Ctrl/⌘+Intro guarda, también desde las notas.
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDone();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return { d, set, setLevel, submit, keys, error, pending: save.isPending };
}
