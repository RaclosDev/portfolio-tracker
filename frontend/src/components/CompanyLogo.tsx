import { useState } from 'react';

/** ISIN sin logo (o con el logo roto) y hasta cuándo no se vuelven a pedir al montar otra vez la fila o el detalle. */
const missing = new Map<string, number>();

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
/** Esperas entre reintentos: un fallo suele ser pasajero (límite de la API al arrancar el servidor). */
const RETRIES_MS = [4_000, 15_000, 60_000];
/** Tras agotar los reintentos, iniciales durante este rato; luego se vuelve a probar. */
const MISSING_MS = 10 * 60_000;

/** ISIN ya visto por símbolo: si la cotización llega de una fuente sin ISIN (Yahoo), el logo no se pierde. */
const KNOWN_KEY = 'logo-isin';
let known: Record<string, string> | null = null;
function knownIsins(): Record<string, string> {
  if (!known) {
    try {
      known = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '{}') as Record<string, string>;
    } catch {
      known = {};
    }
  }
  return known;
}
function rememberIsin(symbol: string, isin: string) {
  const map = knownIsins();
  if (map[symbol] === isin) return;
  map[symbol] = isin;
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify(map));
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo */
  }
}

/** Iniciales del nombre (o del ticker) para cuando no hay logo. */
function initials(name: string) {
  const [a, b] = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (a && b) return (a.charAt(0) + b.charAt(0)).toUpperCase();
  return (a ?? '?').slice(0, 2).toUpperCase();
}

interface Props {
  isin?: string | null;
  /** Símbolo de la cotización: con él se recuerda el ISIN para cuando la fuente no lo traiga. */
  symbol?: string | null;
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
export function CompanyLogo({ isin, symbol, name, size = 28, className = '' }: Props) {
  const given = isin?.trim().toUpperCase();
  const sym = symbol?.trim().toUpperCase();
  if (sym && given && ISIN.test(given)) rememberIsin(sym, given);
  const code = given || (sym ? knownIsins()[sym] : undefined);
  const [attempt, setAttempt] = useState(0);
  const [, rerender] = useState(0);
  const style = { '--logo-size': `${size}px` } as React.CSSProperties;
  const until = code ? missing.get(code) : undefined;
  if (until !== undefined && until <= Date.now()) missing.delete(code!);
  if (!code || !ISIN.test(code) || (until !== undefined && until > Date.now())) {
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
      src={`/api/public/logo/${code}${attempt ? `?r=${attempt}` : ''}`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => {
        const wait = RETRIES_MS[attempt];
        if (wait !== undefined) {
          window.setTimeout(() => setAttempt((n) => n + 1), wait);
          return;
        }
        missing.set(code, Date.now() + MISSING_MS);
        rerender((n) => n + 1);
      }}
    />
  );
}
