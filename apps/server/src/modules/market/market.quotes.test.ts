import { describe, expect, it, vi } from 'vitest';
import { migrate, openPGlite } from '../../db/database.ts';
import { MarketService } from './market.service.ts';
import type { MarketDataProvider } from './provider.ts';

describe('cotizaciones en el servicio de mercado', { timeout: 30_000 }, () => {
  it('dos peticiones a la vez del mismo símbolo hacen una sola llamada al proveedor', async () => {
    const db = openPGlite();
    await migrate(db);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const getQuotes = vi.fn(async (symbols: string[]) => {
      await gate;
      return symbols.map((symbol) => ({ symbol, price: 10, currency: 'EUR' }));
    });
    const market = new MarketService({ id: 'prueba', getQuotes } as unknown as MarketDataProvider, db, { quoteTtlMs: 60_000, targetsTtlMs: 0 });
    const a = market.getQuotes(['AAA']);
    const b = market.getQuotes(['AAA', 'BBB']);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.get('AAA')?.price).toBe(10);
    expect(rb.get('BBB')?.price).toBe(10);
    expect(getQuotes.mock.calls).toEqual([[['AAA']], [['BBB']]]);
  });
});
