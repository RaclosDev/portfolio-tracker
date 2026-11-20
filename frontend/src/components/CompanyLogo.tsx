import { useState } from 'react';

/** Logos que no existen: no se vuelven a pedir al montar otra vez la fila o el detalle. */
const missing = new Set<string>();

/**
 * De dónde sale el logo, por orden: Parqet por ISIN (acciones, ETF y fondos de cualquier bolsa) y
 * Financial Modeling Prep por símbolo (entiende «SAN.MC», «AAPL»…). Ninguno pide clave.
 */
function sources(isin?: string | null, symbol?: string | null): string[] {
  const out: string[] = [];
  if (isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) out.push(`https://assets.parqet.com/logos/isin/${isin}?format=png&size=64`);
  // Índices, divisas, futuros y fondos de Morningstar («^IBEX», «EURUSD=X», «0P…») no tienen logo de empresa.
  if (symbol && /^[A-Z0-9.-]+$/i.test(symbol) && !/^0P/.test(symbol)) out.push(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol.toUpperCase())}.png`);
  return out.filter((u) => !missing.has(u));
}

/** Iniciales del nombre (o del ticker) para cuando no hay logo. */
function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  const [a, b] = words;
  if (a && b) return (a.charAt(0) + b.charAt(0)).toUpperCase();
  return (a ?? '?').slice(0, 2).toUpperCase();
}

interface Props {
  isin?: string | null;
  symbol?: string | null;
  /** Nombre o ticker: de aquí salen las iniciales si no hay logo. */
  name: string;
  /** Lado en píxeles. */
  size?: number;
  className?: string;
}

/** Logo de la empresa para reconocer el valor de un vistazo; decorativo (el nombre va al lado). */
export function CompanyLogo({ isin, symbol, name, size = 28, className = '' }: Props) {
  const list = sources(isin, symbol);
  const key = list.join('|');
  const [failed, setFailed] = useState<{ key: string; n: number }>({ key, n: 0 });
  const n = failed.key === key ? failed.n : 0;
  const src = list[n];
  const style = { '--logo-size': `${size}px` } as React.CSSProperties;
  if (!src) {
    return (
      <span className={`logo logo--initials ${className}`} style={style} aria-hidden>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      key={src}
      className={`logo ${className}`}
      style={style}
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        missing.add(src);
        setFailed({ key, n: n + 1 });
      }}
    />
  );
}
