import { DEFAULT_STATUS_NAMES, type LevelStatus, type WatchlistRow } from '@watchlist/shared';
import { useSettings } from '../../api/hooks.ts';
import { pct, price } from '../../lib/format.ts';
import { useWidth } from '../../lib/useWidth.ts';

const PAD = 16;
const CHIP_H = 24;
const LANE = CHIP_H + 8; // alto de cada fila de etiquetas
const BAND = 64; // franja del recorrido de precios
const AXIS = 22; // fila de cifras del eje
const CHAR = 7.1; // ancho medio de un carácter de las etiquetas

type Kind = LevelStatus | 'order' | 'broker' | 'consensus' | 'price' | 'range';

interface Ref {
  value: number;
  name: string;
  /** Texto corto de la etiqueta sobre el mapa. */
  chip: string;
  /** Detalle para la escalera (estado del nivel, quién da el objetivo…). */
  note?: string;
  kind: Kind;
}

interface Chip extends Ref {
  x: number;
  lane: number;
  left: number;
  w: number;
}

/** Coloca cada etiqueta en la primera fila libre para que no se pisen. */
function place(refs: Ref[], x: (v: number) => number, width: number, maxLanes = 4): { chips: Chip[]; lanes: number } {
  const lanes: [number, number][][] = [];
  const chips = refs.map((r) => {
    const w = r.chip.length * CHAR + 18;
    const left = Math.min(Math.max(x(r.value) - w / 2, 0), width - w);
    let lane = 0;
    while (lane < maxLanes - 1 && (lanes[lane] ?? []).some(([a, b]) => left < b + 6 && left + w > a - 6)) lane++;
    (lanes[lane] ??= []).push([left, left + w]);
    return { ...r, x: x(r.value), lane, left, w };
  });
  return { chips, lanes: lanes.length };
}

/** Marcas "redondas" del eje de precios. */
function niceTicks(min: number, max: number, count: number) {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/**
 * Mapa de precios del detalle: arriba tus compras y la orden, abajo el precio y los objetivos, sobre
 * un eje con cifras; la franja verde es la zona de compra y la barra, el rango de 52 semanas.
 * Debajo, la escalera de precios con la distancia de cada referencia al precio actual.
 */
export function PriceMapLarge({ row }: { row: WatchlistRow }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const names = useSettings().data?.statusNames ?? DEFAULT_STATUS_NAMES;
  const { quote, targets, item, metrics } = row;
  const p = quote?.price;
  const fp = (v: number) => price(v, quote?.currency);

  if (p == null) return <p className="muted">Sin cotización ahora mismo.</p>;

  const lo = quote?.low52 ?? null;
  const hi = quote?.high52 ?? null;
  const consensus = targets?.mean ?? null;
  const order = item.orderActive && item.orderPrice ? item.orderPrice : null;

  const top: Ref[] = metrics.levels.map((l, i) => ({
    value: l.price,
    name: `Compra ${i + 1}`,
    chip: `C${i + 1} · ${fp(l.price)}`,
    note: l.status !== 'unknown' ? names[l.status] : undefined,
    kind: l.status,
  }));
  if (order != null) top.push({ value: order, name: 'Orden', chip: `Orden ${fp(order)}`, note: 'Activa', kind: 'order' });

  const bottom: Ref[] = [{ value: p, name: 'Precio actual', chip: fp(p), kind: 'price' }];
  if (item.brokerTarget != null)
    bottom.push({ value: item.brokerTarget, name: item.brokerName ?? 'Bróker', chip: `${item.brokerName ?? 'Bróker'} ${fp(item.brokerTarget)}`, note: 'Objetivo', kind: 'broker' });
  if (consensus != null)
    bottom.push({ value: consensus, name: 'Consenso', chip: `Consenso ${fp(consensus)}`, note: targets?.analysts ? `${targets.analysts} analistas` : 'Objetivo medio', kind: 'consensus' });

  const range: Ref[] = [
    ...(hi != null ? [{ value: hi, name: 'Máximo 52 semanas', chip: '', kind: 'range' as const }] : []),
    ...(lo != null ? [{ value: lo, name: 'Mínimo 52 semanas', chip: '', kind: 'range' as const }] : []),
  ];

  const values = [...top, ...bottom, ...range].map((r) => r.value).filter(Number.isFinite);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || rawMax * 0.1 || 1;
  const zoneTop = item.buyPrices.length ? Math.max(...item.buyPrices) : null;
  const min = Math.min(rawMin - span * 0.06, zoneTop != null ? zoneTop - span * 0.1 : Infinity);
  const max = rawMax + span * 0.06;
  const W = Math.max(measured, 280);
  const x = (v: number) => PAD + ((v - min) / (max - min)) * (W - PAD * 2);

  const t = place(top, x, W);
  const b = place(bottom, x, W);
  const topLanes = Math.max(1, t.lanes);
  const bandY = topLanes * LANE + 6;
  const midY = bandY + BAND / 2;
  const bottomY = bandY + BAND + 10;
  const axisY = bottomY + b.lanes * LANE + 4;
  const H = axisY + AXIS;
  const chipTop = (lane: number) => (topLanes - 1 - lane) * LANE;
  const chipBottom = (lane: number) => bottomY + lane * LANE;
  const ticks = niceTicks(min, max, Math.max(3, Math.min(10, Math.floor(W / 120))));

  // Escalera: de caro a barato, con el precio actual en su sitio.
  const ladder = [...top, ...bottom, ...range].sort((a, z) => z.value - a.value);
  const maxDist = Math.max(...ladder.map((r) => Math.abs((r.value - p) / p)), 0.0001);
  const rangePos = lo != null && hi != null && hi > lo ? (p - lo) / (hi - lo) : null;

  const summary = [
    `Precio ${fp(p)}`,
    ...metrics.levels.map((l, i) => `Compra ${i + 1}: ${fp(l.price)}, ${pct(l.distancePct)}, ${l.status !== 'unknown' ? names[l.status] : ''}`),
    item.brokerTarget != null ? `Objetivo ${item.brokerName ?? 'bróker'}: ${fp(item.brokerTarget)}` : null,
    consensus != null ? `Consenso: ${fp(consensus)}` : null,
    lo != null && hi != null ? `Rango del último año: ${fp(lo)} a ${fp(hi)}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  const marker = (c: Chip, from: number, to: number) => (
    <g key={`m-${c.name}`} className={`pmx-k pmx-k--${c.kind}`}>
      <line className="pmx-lead" x1={c.x} x2={c.x} y1={from} y2={to} />
      <line className="pmx-mark" x1={c.x} x2={c.x} y1={bandY + 8} y2={bandY + BAND - 8} />
    </g>
  );
  const chip = (c: Chip, y: number) => (
    <g key={`c-${c.name}`} className={`pmx-k pmx-k--${c.kind} pmx-chip`}>
      <rect x={c.left} y={y} width={c.w} height={CHIP_H} rx={5} />
      <text x={c.left + c.w / 2} y={y + CHIP_H / 2 + 4.5} textAnchor="middle">
        {c.chip}
      </text>
    </g>
  );

  return (
    <div className="pmx">
      <div ref={ref} className="pmx-map">
        {measured > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
            <rect className="pmx-band" x={PAD} y={bandY} width={W - PAD * 2} height={BAND} rx={6} />
            {ticks.map((v) => (
              <g key={v} className="pmx-grid">
                <line x1={x(v)} x2={x(v)} y1={bandY} y2={axisY - 4} />
                <text x={x(v)} y={axisY + 12} textAnchor="middle">
                  {price(v)}
                </text>
              </g>
            ))}
            {zoneTop != null && (
              <g className={`pmx-zone${metrics.status === 'reached' ? ' pmx-zone--in' : ''}`}>
                <rect x={PAD} y={bandY} width={Math.max(0, x(zoneTop) - PAD)} height={BAND} rx={6} />
                <text x={PAD + 10} y={bandY + 16}>
                  Zona de compra
                </text>
              </g>
            )}
            <line className="pmx-track" x1={PAD + 8} x2={W - PAD - 8} y1={midY} y2={midY} />
            {lo != null && hi != null && (
              <g className="pmx-range">
                <line x1={x(lo)} x2={x(hi)} y1={midY} y2={midY} />
              </g>
            )}

            {t.chips.map((c) => marker(c, chipTop(c.lane) + CHIP_H, bandY + 8))}
            {b.chips.filter((c) => c.kind !== 'price').map((c) => marker(c, bandY + BAND - 8, chipBottom(c.lane)))}

            {/* Precio actual: línea gruesa que cruza la franja y su etiqueta rellena debajo. */}
            <g className="pmx-now">
              <line x1={x(p)} x2={x(p)} y1={bandY - 4} y2={chipBottom(b.chips[0]!.lane)} />
              <circle cx={x(p)} cy={midY} r={5} />
            </g>

            {/* Extremos del año encima de las marcas, con halo para leerse aunque una línea los cruce. */}
            {lo != null && hi != null && (
              <g className="pmx-range-labels">
                <text x={x(lo)} y={bandY + BAND - 8} textAnchor="start">
                  Mín. 52 s {fp(lo)}
                </text>
                <text x={x(hi)} y={bandY + BAND - 8} textAnchor="end">
                  Máx. 52 s {fp(hi)}
                </text>
              </g>
            )}

            {t.chips.map((c) => chip(c, chipTop(c.lane)))}
            {b.chips.map((c) => chip(c, chipBottom(c.lane)))}
          </svg>
        )}
      </div>

      <div className="pmx-ladder" role="table" aria-label="Escalera de precios">
        <div className="pmx-ladder__head" role="row">
          <span role="columnheader">Referencia</span>
          <span role="columnheader">Precio</span>
          <span role="columnheader">Distancia</span>
        </div>
        {ladder.map((r) => {
          const d = (r.value - p) / p;
          return (
            <div key={r.name} role="row" className={`pmx-ladder__row pmx-k pmx-k--${r.kind}${r.kind === 'price' ? ' pmx-ladder__row--now' : ''}`}>
              <span role="cell" className="pmx-ladder__name">
                <i className="pmx-swatch" aria-hidden="true" />
                {r.name}
                {r.note && <small>{r.note}</small>}
                {r.kind === 'price' && rangePos != null && <small>En el {Math.round(rangePos * 100)} % del rango de 52 s</small>}
              </span>
              <span role="cell" className="pmx-ladder__price">
                {fp(r.value)}
              </span>
              <span role="cell" className="pmx-ladder__dist">
                {r.kind === 'price' ? (
                  '—'
                ) : (
                  <>
                    <span className="pmx-dist-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(2, (Math.abs(d) / maxDist) * 100)}%` }} />
                    </span>
                    <span className={d < 0 ? 'down' : 'up'}>{pct(d)}</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
