import { describe, expect, it } from 'vitest';
import { deleteListMessage } from './deleteListMessage.ts';

describe('aviso al borrar una lista', () => {
  it('nombra la lista y sus valores, y no promete una copia automática de este borrado', () => {
    const text = deleteListMessage('Largo plazo', 12);
    expect(text).toContain('«Largo plazo»');
    expect(text).toContain('12 valores');
    expect(text).toContain('No se hace una copia antes de borrarla');
    expect(text).not.toContain('copia automática');
  });
});
