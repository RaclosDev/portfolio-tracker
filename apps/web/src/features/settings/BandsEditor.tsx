import { DEFAULT_STATUS_NAMES, STATUS_DEFS, type Bands, type Colors, type StatusKey, type StatusNames } from '@watchlist/shared';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { parseDecimal } from '../../lib/format.ts';

type Edge = keyof Bands;
const EDGES: Edge[] = ['veryNear', 'near', 'far'];
const STEP = 0.5;

const fmt = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
const snap = (v: number) => Math.round(v / STEP) * STEP;

/** Cada límite queda entre el anterior y el siguiente (muy cerca ≤ cerca ≤ lejos). */
function clampEdge(b: Bands, edge: Edge, v: number, max: number): number {
  const lo = edge === 'veryNear' ? STEP : edge === 'near' ? b.veryNear : b.near;
  const hi = edge === 'veryNear' ? b.near : edge === 'near' ? b.far : max;
  return Math.min(hi, Math.max(lo, snap(v)));
}

/** Campo de % con coma decimal: se puede escribir libremente y se ajusta al salir. */
function PctField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  return (
    <span className="input-suffix bands__pct">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseDecimal(e.target.value);
          if (n != null && n > 0 && n <= 100) onChange(n);
        }}
        onBlur={() => {
          focused.current = false;
          setText(fmt(value));
        }}
      />
      %
    </span>
  );
}

interface Props {
  bands: Bands;
  names: StatusNames;
  onBands: (b: Bands) => void;
  onNames: (n: StatusNames) => void;
  colors: Colors;
  onColor: (key: StatusKey, value: string) => void;
}

/**
 * Los cinco estados con su nombre y su tramo, y debajo la barra con los límites arrastrables
 * (también con el teclado: flechas ±0,5 %, Re Pág/Av Pág ±5 %).
 */
export function BandsEditor({ bands, names, onBands, onNames, colors, onColor }: Props) {
  // Escala fija mientras se edita, para que la barra no se mueva bajo el dedo; crece si hace falta.
  const [scaleBase] = useState(() => Math.max(30, Math.ceil((bands.far * 1.5) / 5) * 5));
  const max = Math.max(scaleBase, Math.ceil((bands.far * 1.15) / 5) * 5);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<Edge | null>(null);

  const set = (edge: Edge, v: number) => {
    const next = { ...bands, [edge]: clampEdge(bands, edge, v, max) };
    if (next[edge] !== bands[edge]) onBands(next);
  };
  const at = (v: number) => `${(Math.min(v, max) / max) * 100}%`;

  const onPointerDown = (edge: Edge) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    dragging.current = edge;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const edge = dragging.current;
    const rect = track.current?.getBoundingClientRect();
    if (!edge || !rect) return;
    set(edge, ((e.clientX - rect.left) / rect.width) * max);
  };
  const onPointerUp = () => (dragging.current = null);

  const onKey = (edge: Edge) => (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowRight: STEP, ArrowUp: STEP, ArrowLeft: -STEP, ArrowDown: -STEP, PageUp: 5, PageDown: -5 }[e.key];
    if (delta != null) set(edge, bands[edge] + delta);
    else if (e.key === 'Home') set(edge, 0);
    else if (e.key === 'End') set(edge, max);
    else return;
    e.preventDefault();
  };

  const range = (key: StatusKey) => {
    switch (key) {
      case 'reached':
        return <span className="bands__range">el precio ya está por debajo de tu nivel</span>;
      case 'veryFar':
        return <span className="bands__range">más de un {fmt(bands.far)} %</span>;
      default: {
        const from = key === 'veryNear' ? 0 : key === 'near' ? bands.veryNear : bands.near;
        return (
          <span className="bands__range">
            de {fmt(from)} hasta <PctField label={`Límite de «${names[key]}»`} value={bands[key]} onChange={(v) => set(key, v)} />
          </span>
        );
      }
    }
  };

  const segments: { key: StatusKey; from: number; to: number }[] = [
    { key: 'veryNear', from: 0, to: bands.veryNear },
    { key: 'near', from: bands.veryNear, to: bands.near },
    { key: 'far', from: bands.near, to: bands.far },
    { key: 'veryFar', from: bands.far, to: max },
  ];

  return (
    <div className="bands">
      <div className="bands__rows">
        {STATUS_DEFS.map(({ key }) => (
          <div key={key} className="bands__row">
            <input
              type="color"
              className="bands__color"
              aria-label={`Color de «${names[key] || DEFAULT_STATUS_NAMES[key]}»`}
              title="Cambiar el color"
              value={colors[key]}
              onChange={(e) => onColor(key, e.target.value)}
            />
            <input
              type="text"
              className="bands__name"
              aria-label={`Nombre del estado «${DEFAULT_STATUS_NAMES[key]}»`}
              maxLength={24}
              value={names[key]}
              placeholder={DEFAULT_STATUS_NAMES[key]}
              onChange={(e) => onNames({ ...names, [key]: e.target.value })}
            />
            {range(key)}
          </div>
        ))}
      </div>

      <div className="bands__chart">
        <div className="bands__zone" title={names.reached || DEFAULT_STATUS_NAMES.reached}>
          <span className="bands__seg bands__seg--reached" />
        </div>
        <div className="bands__track" ref={track} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {segments.map((s) => (
            <span
              key={s.key}
              className={`bands__seg bands__seg--${s.key}`}
              style={{ left: at(s.from), width: `calc(${at(s.to)} - ${at(s.from)})` }}
              title={names[s.key]}
            />
          ))}
          {EDGES.map((edge) => (
            <div
              key={edge}
              className={`bands__handle bands__handle--${edge}`}
              style={{ left: at(bands[edge]) }}
              role="slider"
              tabIndex={0}
              aria-label={`Límite de «${names[edge] || DEFAULT_STATUS_NAMES[edge]}»`}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={bands[edge]}
              aria-valuetext={`${fmt(bands[edge])} %`}
              onPointerDown={onPointerDown(edge)}
              onKeyDown={onKey(edge)}
            >
              <span className="bands__grip" />
            </div>
          ))}
          <span className="bands__tick" style={{ left: 0 }}>0</span>
          {EDGES.map((edge) => (
            <span key={edge} className="bands__tick" style={{ left: at(bands[edge]) }}>
              {fmt(bands[edge])}
            </span>
          ))}
          <span className="bands__tick bands__tick--end">∞</span>
        </div>
      </div>
      <p className="small muted">Arrastra las marcas para mover los límites (% que le falta caer al precio hasta tu nivel).</p>
    </div>
  );
}
