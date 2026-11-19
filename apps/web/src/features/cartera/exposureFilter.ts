import type { ExposureRow } from '@watchlist/shared';

/** Origen que agrupa las acciones que se tienen en directo (las partes sin peso de fondo). */
export const DIRECT = '__directo__';

export interface ExposureFilter {
  /** Texto a buscar en el nombre o el ISIN de la empresa. */
  q: string;
  /** Fondos (por ticker) y/o `DIRECT`; vacío = todos. Los importes se limitan a lo que viene de ellos. */
  sources: string[];
  /** Solo empresas que llegan por dos o más vías (solapamientos). */
  repeated: boolean;
  /** Oculta las empresas por debajo de este importe en euros. */
  minEur: number;
}

export const NO_FILTER: ExposureFilter = { q: '', sources: [], repeated: false, minEur: 0 };

const sourceOf = (p: ExposureRow['parts'][number]) => (p.weight == null ? DIRECT : p.ticker);
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Los orígenes que aparecen en la exposición, de mayor a menor importe. */
export function exposureSources(rows: ExposureRow[]): { id: string; label: string; name: string; eur: number }[] {
  const map = new Map<string, { id: string; label: string; name: string; eur: number }>();
  for (const r of rows)
    for (const p of r.parts) {
      const id = sourceOf(p);
      const s = map.get(id) ?? { id, label: id === DIRECT ? 'En directo' : p.ticker, name: id === DIRECT ? 'Acciones en directo' : p.name, eur: 0 };
      s.eur += p.eur;
      map.set(id, s);
    }
  return [...map.values()].sort((a, b) => b.eur - a.eur);
}

export function filterExposure(rows: ExposureRow[], totalEur: number, f: ExposureFilter): ExposureRow[] {
  const q = norm(f.q.trim());
  const sources = new Set(f.sources);
  const out: ExposureRow[] = [];
  for (const r of rows) {
    if (q && !norm(r.name).includes(q) && !(r.isin ?? '').toLowerCase().includes(q) && !(r.ticker ?? '').toLowerCase().includes(q)) continue;
    let row = r;
    if (sources.size) {
      const parts = r.parts.filter((p) => sources.has(sourceOf(p)));
      if (!parts.length) continue;
      const directEur = parts.reduce((s, p) => s + (p.weight == null ? p.eur : 0), 0);
      const fundsEur = parts.reduce((s, p) => s + (p.weight == null ? 0 : p.eur), 0);
      const total = directEur + fundsEur;
      row = { ...r, parts, directEur, fundsEur, totalEur: total, weight: totalEur ? total / totalEur : 0 };
    }
    if (f.repeated && row.parts.length < 2) continue;
    if (row.totalEur < f.minEur) continue;
    out.push(row);
  }
  return out;
}
