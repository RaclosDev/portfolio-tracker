import { describe, expect, it } from 'vitest';
import { migrate, openPGlite, type Db } from './database.ts';
import { migrations } from './migrations.ts';
import { schemaDatabase } from './scoped.ts';

async function installBeforeFundRepair(db: Db) {
  await db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (let index = 0; index < 5; index++) {
    await db.exec(migrations[index]!);
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [index + 1]);
  }
}

describe('reparación de cotizaciones de fondos importados', () => {
  it('recupera los vínculos omitidos o mal formados y conserva las operaciones y fichas editadas de cada cuenta', async () => {
    const root = openPGlite();
    try {
      const schema = `account_${'a'.repeat(32)}`;
      await root.exec(`CREATE SCHEMA ${schema}`);
      const other = schemaDatabase(root, schema);
      for (const db of [root, other]) await installBeforeFundRepair(db);
      const cases = [
        { ticker: '0P0001OJNQ.F', symbol: '0P0001OJNQ.F.MC', expected: '0P0001OJNQ.F' },
        { ticker: '0P0001F2GG.F', symbol: null, expected: '0P0001F2GG.F' },
        { ticker: '0P00016YQ5.F', symbol: '0P00016YQ5.F', expected: '0P00016YQ5.F' },
        { ticker: '0P000190VT.F', symbol: 'CLASE.L', expected: 'CLASE.L' },
        { ticker: '0P00000001.F', symbol: null, expected: null, edited: true },
        { ticker: '0P00000002.F', symbol: null, expected: null, source: 'manual' },
        { ticker: '0P00000003', symbol: '0P00000003.MC', expected: '0P00000003' },
        { ticker: 'IE00B3VXGD32', symbol: null, expected: null },
        { ticker: 'AAA', symbol: 'AAA.MC', expected: 'AAA.MC' },
      ];
      for (const sample of cases) {
        await other.query(`INSERT INTO instruments (ticker, symbol, name, currency, notes, created_at, updated_at)
          VALUES ($1, $2, 'Nombre conservado', 'EUR', 'Notas conservadas', '2026-01-01', $3)`,
        [sample.ticker, sample.symbol, sample.edited ? '2026-01-02' : '2026-01-01']);
        await other.query(`INSERT INTO operations (date, ticker, type, shares, price, amount_eur, source)
          VALUES ('2026-01-01', $1, 'buy', 2.5, 10, 25, $2)`, [sample.ticker, sample.source ?? 'excel']);
      }
      await root.query("INSERT INTO instruments (ticker, symbol) VALUES ('0P0001F2GG.F', 'OTRA.CLASE')");
      const originalOperations = await other.query('SELECT * FROM operations ORDER BY id');
      const originalInstruments = await other.query('SELECT ticker, name, currency, notes FROM instruments ORDER BY ticker');
      await migrate(root);
      await migrate(other);
      for (const sample of cases) {
        expect(await other.one('SELECT symbol FROM instruments WHERE ticker = $1', [sample.ticker]))
          .toEqual({ symbol: sample.expected });
      }
      expect(await root.one("SELECT symbol FROM instruments WHERE ticker = '0P0001F2GG.F'"))
        .toEqual({ symbol: 'OTRA.CLASE' });
      expect(await other.query('SELECT * FROM operations ORDER BY id'))
        .toEqual(originalOperations.map(operation => ({ ...operation, transfer_ref: null })));
      expect(await other.query('SELECT ticker, name, currency, notes FROM instruments ORDER BY ticker')).toEqual(originalInstruments);
      const repaired = await other.query('SELECT * FROM instruments ORDER BY ticker');
      await migrate(other);
      expect(await other.query('SELECT * FROM instruments ORDER BY ticker')).toEqual(repaired);
    } finally {
      await root.close();
    }
  });
});
