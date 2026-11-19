/** Exposición real: lo que se tiene de cada empresa sumando las acciones directas y las que llevan dentro los fondos. */
import type { HoldingRow } from './view.ts';

export interface FundHolding {
  name: string;
  isin: string | null;
  /** Ticker tal como lo da la fuente (NVDA, NVDA:NSQ…), si lo da. */
  ticker: string | null;
  /** Peso en el fondo, de 0 a 1. */
  weight: number;
}

/** Posiciones de un fondo o ETF: la cartera completa (Financial Hub) o solo las mayores (las demás fuentes). */
export interface FundComposition {
  holdings: FundHolding[];
  /** Fecha de la composición (AAAA-MM-DD) si la fuente la indica. */
  asOf: string | null;
  source: string;
  fetchedAt: string;
}

export interface ExposurePart {
  /** Ticker de la posición de la cartera de la que sale este importe. */
  ticker: string;
  name: string;
  eur: number;
  /** Peso de la empresa dentro del fondo; null si es una posición directa. */
  weight: number | null;
}

export interface ExposureRow {
  key: string;
  name: string;
  isin: string | null;
  /** Ticker con el que se la conoce: el de la cartera si se tiene en directo; si no, el que dé la fuente del fondo. */
  ticker: string | null;
  directEur: number;
  fundsEur: number;
  totalEur: number;
  /** Parte del valor total de la cartera. */
  weight: number;
  parts: ExposurePart[];
}

export interface Exposure {
  rows: ExposureRow[];
  /** Lo que los fondos no desglosan (fuera de sus mayores posiciones) o fondos sin composición conocida. */
  rest: ExposurePart[];
  restEur: number;
  totalEur: number;
}

const NOISE = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'sa', 'se', 'nv', 'ag', 'spa',
  'asa', 'ab', 'oyj', 'kgaa', 'adr', 'ads', 'reg', 'registered', 'shs', 'ordinary', 'shares', 'the', 'holding', 'holdings',
  'group', 'class', 'namen', 'aktie', 'aktien', 'sponsored', 'com', 'cl', 'ord',
]);
/** Empresas que cada fuente nombra de forma distinta. */
const ALIASES: [RegExp, string][] = [
  [/\btsmc\b|taiwan semiconductor/, 'tsmc'],
  [/\balphabet\b/, 'alphabet'],
  [/\bberkshire hathaway\b/, 'berkshire hathaway'],
  [/\basml\b/, 'asml'],
  [/^amazon(com)?\b/, 'amazon'],
];

/** Nombre reducido a lo que identifica a la empresa: «NVIDIA Corp.» y «Nvidia» son la misma. */
export function companyKey(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(class|cl|series)\s+[a-z]\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const alias = ALIASES.find(([re]) => re.test(plain));
  if (alias) return alias[1];
  const words = plain.split(' ').filter((w) => w && !NOISE.has(w));
  // «Eli Lilly and Co» queda en «eli lilly and»: la conjunción suelta del final sobra.
  while (words.length > 1 && words.at(-1) === 'and') words.pop();
  return (words.length ? words : plain.split(' ')).join(' ');
}

/** Ticker de una posición de fondo sin la bolsa que añaden algunas fuentes: «NVDA:NSQ» → «NVDA». */
const fundTicker = (t: string | null) => t?.split(':')[0]?.trim().toUpperCase() || null;

const FUND_TYPES = new Set(['ETF', 'MUTUALFUND', 'FUND']);
export const isFundType = (quoteType: string | null | undefined) => !!quoteType && FUND_TYPES.has(quoteType.toUpperCase());

/**
 * Reparte el valor de cada posición abierta entre las empresas que hay detrás. Una acción directa va entera a su
 * empresa; un fondo con composición se reparte según los pesos y lo que no desglosa queda en `rest`.
 */
export function computeExposure(open: HoldingRow[], compositions: Record<string, FundComposition | null>): Exposure {
  const byIsin = new Map<string, ExposureRow>();
  const byName = new Map<string, ExposureRow>();
  const rows: ExposureRow[] = [];
  const rest: ExposurePart[] = [];

  const rowFor = (name: string, isin: string | null, ticker: string | null): ExposureRow => {
    const nameKey = companyKey(name);
    let row = (isin ? byIsin.get(isin) : undefined) ?? byName.get(nameKey);
    if (!row) {
      row = { key: isin ?? nameKey, name, isin, ticker, directEur: 0, fundsEur: 0, totalEur: 0, weight: 0, parts: [] };
      rows.push(row);
    }
    if (isin && !byIsin.has(isin)) byIsin.set(isin, row);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, row);
    row.isin ??= isin;
    row.ticker ??= ticker;
    return row;
  };

  const priced = open.filter((r) => r.valueEur != null && r.valueEur > 0);
  // Primero las acciones directas: su nombre (el de la cartera) es el que se muestra.
  const funds: { row: HoldingRow; composition: FundComposition | null }[] = [];
  for (const r of priced) {
    const composition = compositions[r.ticker];
    if (composition?.holdings.length || isFundType(r.quote?.quoteType)) {
      funds.push({ row: r, composition: composition ?? null });
      continue;
    }
    const row = rowFor(r.name, r.instrument?.isin ?? r.quote?.isin ?? null, r.ticker);
    row.directEur += r.valueEur!;
    row.parts.push({ ticker: r.ticker, name: r.name, eur: r.valueEur!, weight: null });
  }
  for (const { row: fund, composition } of funds) {
    let known = 0;
    for (const h of composition?.holdings ?? []) {
      if (!(h.weight > 0) || known + h.weight > 1.005) continue;
      known += h.weight;
      const eur = fund.valueEur! * h.weight;
      const row = rowFor(h.name, h.isin, fundTicker(h.ticker));
      row.fundsEur += eur;
      // Dos clases de la misma empresa (Alphabet A y C) en un fondo son una sola parte.
      const same = row.parts.find((p) => p.ticker === fund.ticker && p.weight != null);
      if (same) {
        same.eur += eur;
        same.weight! += h.weight;
      } else row.parts.push({ ticker: fund.ticker, name: fund.name, eur, weight: h.weight });
    }
    const left = fund.valueEur! * Math.max(0, 1 - known);
    if (left > 0.005) rest.push({ ticker: fund.ticker, name: fund.name, eur: left, weight: composition ? Math.max(0, 1 - known) : null });
  }

  const totalEur = priced.reduce((s, r) => s + r.valueEur!, 0);
  for (const row of rows) {
    row.totalEur = row.directEur + row.fundsEur;
    row.weight = totalEur ? row.totalEur / totalEur : 0;
    row.parts.sort((a, b) => b.eur - a.eur);
  }
  rows.sort((a, b) => b.totalEur - a.totalEur);
  rest.sort((a, b) => b.eur - a.eur);
  return { rows, rest, restEur: rest.reduce((s, p) => s + p.eur, 0), totalEur };
}
