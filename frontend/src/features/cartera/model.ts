import {
  computeLedger,
  computeTaxYears,
  localToday,
  valueCartera,
  withKinds,
  type CarteraValuation,
  type CarteraView,
  type Ledger,
  type TaxYear,
} from '@/shared';
import { useMemo } from 'react';

export interface CarteraModel {
  view: CarteraView;
  ledger: Ledger;
  valuation: CarteraValuation;
  taxYears: TaxYear[];
  /** Nombre de cada ticker (instrumento o cotización). */
  names: Map<string, string>;
  brokers: string[];
}

/** Libro FIFO, valoración y Renta a partir del registro (todo en el navegador, con el motor compartido). */
export function buildModel(view: CarteraView): CarteraModel {
  const ledger = computeLedger(view.operations, withKinds(view.instruments, view.quotes));
  const valuation = valueCartera({
    ledger,
    instruments: view.instruments,
    quotes: view.quotes,
    fx: view.fx,
    today: localToday(),
  });
  const taxYears = computeTaxYears(ledger, new Date().getFullYear());
  const names = new Map<string, string>();
  for (const r of [...valuation.open, ...valuation.closed]) names.set(r.ticker, r.name);
  const brokers = [...new Set(view.operations.map((o) => o.broker).filter((b): b is string => !!b))].sort();
  return { view, ledger, valuation, taxYears, names, brokers };
}

export function useCarteraModel(view: CarteraView | undefined): CarteraModel | null {
  return useMemo(() => (view ? buildModel(view) : null), [view]);
}

// Un cero (redondeado a céntimos) no es ganancia ni pérdida: va sin color.
export const signed = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? '' : v > 0 ? 'up' : 'down');
