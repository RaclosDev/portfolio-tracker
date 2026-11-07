import { z } from 'zod';

z.config(z.locales.es());

export const MAX_BUY_LEVELS = 3;

const price = z.number().positive().finite();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const mutedSchema = z.union([isoDate, z.literal('always')]);

export const itemInputSchema = z.object({
  listId: z.number().int().positive(),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().max(120).nullable().default(null),
  buyPrices: z.array(price).max(MAX_BUY_LEVELS).default([]),
  brokerTarget: price.nullable().default(null),
  brokerName: z.string().trim().max(40).nullable().default(null),
  investAmount: price.nullable().default(null),
  sharesOverride: z.number().int().positive().nullable().default(null),
  orderActive: z.boolean().default(false),
  orderPrice: price.nullable().default(null),
  orderUntil: isoDate.nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
  /** Avisos silenciados hasta esta fecha (incluida) o 'always'. */
  mutedUntil: mutedSchema.nullable().default(null),
});
export type ItemInput = z.input<typeof itemInputSchema>;
export type ItemData = z.output<typeof itemInputSchema>;

/** Para PATCH: sin valores por defecto, solo los campos enviados. */
export const itemPatchSchema = z.object({
  listId: z.number().int().positive(),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().max(120).nullable(),
  buyPrices: z.array(price).max(MAX_BUY_LEVELS),
  brokerTarget: price.nullable(),
  brokerName: z.string().trim().max(40).nullable(),
  investAmount: price.nullable(),
  sharesOverride: z.number().int().positive().nullable(),
  orderActive: z.boolean(),
  orderPrice: price.nullable(),
  orderUntil: isoDate.nullable(),
  notes: z.string().max(2000).nullable(),
  mutedUntil: mutedSchema.nullable(),
}).partial();
export type ItemPatch = z.input<typeof itemPatchSchema>;

export const listInputSchema = z.object({ name: z.string().trim().min(1).max(60) });

/** Colores configurables de la interfaz. El orden y los grupos son los del formulario de Ajustes. */
export const COLOR_DEFS = [
  { key: 'reached', label: 'En zona de compra', group: 'Estados', default: '#16a34a' },
  { key: 'near', label: 'Cerca', group: 'Estados', default: '#d97706' },
  { key: 'far', label: 'Lejos', group: 'Estados', default: '#64748b' },
  { key: 'veryFar', label: 'Muy lejos', group: 'Estados', default: '#a1a1aa' },
  { key: 'order', label: 'Orden activa', group: 'Estados', default: '#eab308' },
  { key: 'expired', label: 'Orden caducada', group: 'Estados', default: '#dc2626' },
  { key: 'fx', label: 'Otra divisa (USD…)', group: 'Tabla', default: '#0284c7' },
  { key: 'up', label: 'Sube en el día / potencial', group: 'Tabla', default: '#16a34a' },
  { key: 'down', label: 'Baja en el día', group: 'Tabla', default: '#ea580c' },
  { key: 'broker', label: 'Objetivo bróker', group: 'Mapa de precios', default: '#7c3aed' },
  { key: 'consensus', label: 'Consenso analistas', group: 'Mapa de precios', default: '#2563eb' },
] as const;
export type ColorKey = (typeof COLOR_DEFS)[number]['key'];

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Color #RRGGBB');
export const colorsSchema = z.object(
  Object.fromEntries(COLOR_DEFS.map((c) => [c.key, hexColor.default(c.default)])) as {
    [K in ColorKey]: z.ZodDefault<typeof hexColor>;
  },
);
export type Colors = z.output<typeof colorsSchema>;
export const DEFAULT_COLORS: Colors = colorsSchema.parse({});

export const settingsSchema = z.object({
  baseCurrency: z.string().length(3).default('EUR'),
  defaultInvest: price.default(2500),
  /** Hasta este % por encima del nivel de compra: "cerca". */
  nearThresholdPct: z.number().min(0).max(100).default(5),
  /** Hasta este % : "lejos"; más allá: "muy lejos". */
  farThresholdPct: z.number().min(0).max(100).default(15),
  /** Hacer parpadear los valores en zona de compra. */
  blinkReached: z.boolean().default(true),
  refreshSeconds: z.number().int().min(15).max(3600).default(60),
  colors: colorsSchema.default(DEFAULT_COLORS),
  /** Aspecto */
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  density: z.enum(['compact', 'normal', 'comfortable']).default('normal'),
  fontSize: z.enum(['small', 'normal', 'large']).default('normal'),
  /** Columnas ocultas de la tabla (ids). */
  hiddenColumns: z.array(z.string().max(30)).max(30).default([]),
  /** Columnas opcionales activadas (datos fundamentales y fechas clave). */
  extraColumns: z.array(z.string().max(30)).max(30).default([]),
});
export type Settings = z.output<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  settings: settingsSchema.partial().optional(),
  lists: z.array(
    z.object({
      name: z.string().min(1),
      items: z.array(itemInputSchema.omit({ listId: true })),
    }),
  ),
});
export type Backup = z.input<typeof backupSchema>;
