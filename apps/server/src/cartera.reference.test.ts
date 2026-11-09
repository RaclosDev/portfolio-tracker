/**
 * Prueba de referencia con el Excel real de la cartera: el motor tiene que dar las mismas cifras que el Excel.
 * El Excel tiene datos personales y no está en el repositorio: solo se ejecuta si se indica su ruta.
 *
 *   CARTERA_XLSX="C:/ruta/al/Excel.xlsx" npx vitest run apps/server/src/cartera.reference.test.ts
 */
import { computeLedger, operationInputSchema, parseRegistro, parseResumenTotals, type Cell } from '@watchlist/shared';
import { describe, expect, it } from 'vitest';

const file = process.env.CARTERA_XLSX;

describe.skipIf(!file)('Excel de referencia', () => {
  it('cuadra P/G realizadas, cobros y acciones con el Excel', async () => {
    const { default: readXlsxFile } = await import('read-excel-file/node');
    const sheets = await readXlsxFile(file!);
    const registro = sheets.find((s) => s.sheet === 'Registro')!;
    const resumen = sheets.find((s) => s.sheet.startsWith('Resumen'))!;
    const parsed = parseRegistro(registro.data as Cell[][]);
    expect(parsed.warnings.every((w) => /scrip sin acciones/.test(w))).toBe(true);
    const ops = parsed.operations.map((o, i) => ({ id: i + 1, ...operationInputSchema.parse(o) }));
    const ledger = computeLedger(ops);
    expect(ledger.issues).toEqual([]);

    const excel = parseResumenTotals(resumen.data as Cell[][])!;
    const realized = ledger.tickers.reduce((s, t) => s + t.realizedEur, 0);
    const income = ledger.tickers.reduce((s, t) => s + t.dividendsEur + t.otherIncomeEur, 0);
    console.info(
      `Realizado: web ${realized.toFixed(2)} / Excel ${excel.realizedEur?.toFixed(2)} · ` +
        `Cobros: web ${income.toFixed(2)} / Excel ${excel.incomeEur?.toFixed(2)}`,
    );
    expect(income).toBeCloseTo(excel.incomeEur!, 1);
    // El scrip se reparte entre todos los lotes (regla fiscal); el Excel lo sumaba al último. Eso mueve coste
    // entre lo vendido y lo que queda, pero «realizado − coste de lo que queda» (y la P/G total) no cambia.
    const openCost = ledger.tickers.reduce((s, t) => s + t.costEur, 0);
    const excelOpenCost = excel.valueEur! - excel.unrealizedEur!;
    console.info(`Realizado − coste de lo que queda: web ${(realized - openCost).toFixed(2)} / Excel ${(excel.realizedEur! - excelOpenCost).toFixed(2)}`);
    expect(realized - openCost).toBeCloseTo(excel.realizedEur! - excelOpenCost, 1);

    const open = Object.fromEntries(ledger.tickers.filter((t) => t.shares > 0).map((t) => [t.ticker, Math.round(t.shares)]));
    console.info('Posiciones abiertas:', open);
    expect(Object.keys(open).length).toBeGreaterThan(0);
  });
});
