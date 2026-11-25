import { num, price } from '../../lib/format.ts';
import { perLevels } from '../../lib/per.ts';
import { HoverInfo } from '../../components/HoverInfo.tsx';

/**
 * PER de la tabla de Vigilar. Con precios de compra, el número abre el mismo popover que Notas y
 * En cartera, con el PER que tendría el valor a cada uno de ellos.
 */
export function PerInfo({ pe, current, levels, currency }: {
  pe: number | null | undefined;
  current: number | null | undefined;
  levels: number[];
  currency?: string | null;
}) {
  const rows = perLevels(pe, current, levels);
  if (!rows.length) return <span className="num">{num(pe, 1)}</span>;
  return (
    <HoverInfo
      trigger={<span className="num">{num(pe, 1)}</span>}
      label="Ver el PER a cada precio de compra"
      className="note-btn per-btn"
      popClassName="holding-pop"
      inline={num(pe, 1)}
    >
      <strong className="holding-pop__title">PER</strong>
      <dl className="holding-pop__list">
        <dt>Actual</dt>
        <dd className="num">{num(pe, 1)}</dd>
        {rows.map((r) => (
          <PerRow key={r.n} label={`Compra ${r.n} (${price(r.price, currency)})`} per={r.per} />
        ))}
      </dl>
    </HoverInfo>
  );
}

function PerRow({ label, per }: { label: string; per: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="num">{num(per, 1)}</dd>
    </>
  );
}
