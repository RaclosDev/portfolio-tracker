import { describe, expect, it, vi } from 'vitest';
import { listCreator } from './ensureList.ts';

describe('lista nueva al importar', () => {
  it('reintentar con el mismo nombre no crea otra lista', async () => {
    const create = vi.fn(async () => ({ id: 7 }));
    const ensure = listCreator(create);
    expect(await ensure('Nueva')).toBe(7);
    expect(await ensure('Nueva')).toBe(7);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('si falla la creación, el reintento la vuelve a pedir', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce({ id: 3 });
    const ensure = listCreator(create);
    await expect(ensure('Nueva')).rejects.toThrow('red');
    expect(await ensure('Nueva')).toBe(3);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('con otro nombre sí es otra lista', async () => {
    const create = vi.fn().mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 });
    const ensure = listCreator(create);
    expect(await ensure('A')).toBe(1);
    expect(await ensure('B')).toBe(2);
  });
});
