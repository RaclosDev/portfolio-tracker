const LOCALE = 'es-ES';

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = cache.get(key);
  if (!f) cache.set(key, (f = new Intl.NumberFormat(LOCALE, opts)));
  return f;
}

/** Marca de dato vacío en tablas (guion corto). */
const DASH = '–';

/** Precio con decimales adaptados a su magnitud (2,485 vs 276,47). */
export function price(v: number | null | undefined) {
  if (v == null) return DASH;
  const digits = Math.abs(v) < 10 ? 3 : 2;
  return nf(`p${digits}`, { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(v);
}

export function money(v: number | null | undefined, currency = 'EUR', digits = 0) {
  if (v == null) return DASH;
  const cur = currency === 'GBp' ? 'GBP' : currency;
  try {
    return nf(`m${cur}${digits}`, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(currency === 'GBp' ? v / 100 : v);
  } catch {
    return `${num(v, digits)} ${currency}`;
  }
}

export function num(v: number | null | undefined, digits = 0) {
  if (v == null) return DASH;
  return nf(`n${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** Porcentaje con signo: +12,3 % / −4,1 % */
export function pct(v: number | null | undefined, digits = 1) {
  if (v == null) return DASH;
  return nf(`pc${digits}`, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: 'exceptZero',
  }).format(v);
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return DASH;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y!.slice(2)}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return DASH;
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** Acepta "8,5", "8.5", "1.234,5" o "1,234.5". Devuelve null si está vacío o no es un número. */
export function parseDecimal(input: string): number | null {
  const t = input.trim().replace(/\s|€|\$/g, '');
  if (!t) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const normalized =
    lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Divisas que cotizan en centésimas (Londres en peniques, etc.). */
export const MINOR_CURRENCY: Record<string, string> = {
  GBp: 'Cotiza en peniques: 100 GBp = 1 £',
  GBX: 'Cotiza en peniques: 100 GBX = 1 £',
  ILA: 'Cotiza en agorot: 100 ILA = 1 ₪',
  ZAc: 'Cotiza en céntimos de rand: 100 ZAc = 1 R',
};

export const RECOMMENDATION_ES: Record<string, string> = {
  strong_buy: 'Compra fuerte',
  buy: 'Comprar',
  hold: 'Mantener',
  underperform: 'Infraponderar',
  sell: 'Vender',
  strong_sell: 'Venta fuerte',
};

/** Cifras grandes abreviadas: 195 mil M / 2,5 mil M / 840 M. */
export function compact(v: number | null | undefined, currency?: string | null) {
  if (v == null) return DASH;
  // Escala española: millones, miles de millones y billones (10^12).
  const [div, unit] = v >= 1e12 ? [1e12, 'B'] : v >= 1e9 ? [1e9, 'mil M'] : v >= 1e6 ? [1e6, 'M'] : [1, ''];
  const txt = `${num(v / div, v / div < 100 ? 1 : 0)}${unit ? ` ${unit}` : ''}`;
  return currency ? `${txt} ${currency}` : txt;
}

/** Días naturales desde hoy hasta una fecha AAAA-MM-DD (negativo si ya pasó). */
export function daysUntil(iso: string | null | undefined, today = new Date()) {
  if (!iso) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(iso.slice(0, 10)) - t) / 86_400_000);
}
