import { useState } from 'react';

/** ISIN sin logo (o con el logo roto): no se vuelven a pedir al montar otra vez la fila o el detalle. */
const missing = new Set<string>();

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Iniciales del nombre (o del ticker) para cuando no hay logo. */
function initials(name: string) {
  const [a, b] = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (a && b) return (a.charAt(0) + b.charAt(0)).toUpperCase();
  return (a ?? '?').slice(0, 2).toUpperCase();
}

interface Props {
  isin?: string | null;
  /** Nombre o ticker: de aquí salen las iniciales si no hay logo. */
  name: string;
  /** Lado en píxeles. */
  size?: number;
  className?: string;
}

/**
 * Logo de la empresa (o de la gestora del fondo) para reconocer el valor de un vistazo. Sale de Financial Hub,
 * la misma fuente que los precios, en SVG; el servidor busca el ISIN y redirige al logo. Sin ISIN o sin logo,
 * iniciales. Decorativo: el nombre va siempre al lado.
 */
export function CompanyLogo({ isin, name, size = 28, className = '' }: Props) {
  const code = isin?.trim().toUpperCase();
  const [, rerender] = useState(0);
  const style = { '--logo-size': `${size}px` } as React.CSSProperties;
  if (!code || !ISIN.test(code) || missing.has(code)) {
    return (
      <span className={`logo logo--initials ${className}`} style={style} aria-hidden>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className={`logo ${className}`}
      style={style}
      src={`/api/public/logo/${code}`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => {
        missing.add(code);
        rerender((n) => n + 1);
      }}
    />
  );
}
