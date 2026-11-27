import type { ChartDrawing } from '@/shared';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawingsKey, drawingsSave, NOT_LOADED } from './drawingsQuery.ts';

// El cliente real toca `window` al cargarse: aquí solo importa a quién se llama y con qué.
const saveDrawings = vi.hoisted(() => vi.fn(async (_symbol: string, drawings: ChartDrawing[]) => drawings));
vi.mock('../../api/client.ts', () => ({ api: { saveDrawings, drawings: vi.fn() } }));

const hline = (id: string, p: number): ChartDrawing => ({ id, type: 'hline', points: [{ t: '2026-11-17', p }] });
const a = hline('a', 10.5);
const b = hline('b', 12.5);

/** Dibuja `next` como lo hace el gráfico y devuelve cómo acabó el guardado. */
async function draw(qc: QueryClient, next: ChartDrawing[]) {
  const mutation = new MutationObserver(qc, drawingsSave(qc, 'SAN.MC'));
  return mutation.mutate(next).then(() => 'guardado', (error: Error) => error.message);
}

describe('guardado de los dibujos del gráfico', () => {
  let qc: QueryClient;
  beforeEach(() => {
    saveDrawings.mockClear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('con la carga pendiente, dibujar no llama a saveDrawings', async () => {
    void qc.fetchQuery({ queryKey: drawingsKey('SAN.MC'), queryFn: () => new Promise<ChartDrawing[]>(() => {}) });
    expect(qc.getQueryState(drawingsKey('SAN.MC'))?.status).toBe('pending');
    expect(await draw(qc, [b])).toBe(NOT_LOADED);
    expect(saveDrawings).not.toHaveBeenCalled();
  });

  it('con la carga fallida, dibujar no llama a saveDrawings ni da por buena la lista', async () => {
    await qc.fetchQuery({ queryKey: drawingsKey('SAN.MC'), queryFn: () => Promise.reject(new Error('sin red')) }).catch(() => {});
    expect(qc.getQueryState(drawingsKey('SAN.MC'))?.status).toBe('error');
    expect(await draw(qc, [b])).toBe(NOT_LOADED);
    expect(saveDrawings).not.toHaveBeenCalled();
    expect(qc.getQueryData(drawingsKey('SAN.MC'))).toBeUndefined();
  });

  it('con [a] cargado, dibujar envía [a, b]', async () => {
    qc.setQueryData(drawingsKey('SAN.MC'), [a]);
    expect(await draw(qc, [a, b])).toBe('guardado');
    expect(saveDrawings).toHaveBeenCalledExactlyOnceWith('SAN.MC', [a, b]);
    expect(qc.getQueryData(drawingsKey('SAN.MC'))).toEqual([a, b]);
  });
});
