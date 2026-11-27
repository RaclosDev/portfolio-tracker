import { describe, expect, it } from 'vitest';
import { resultsMatchTyped } from './searchEnter.ts';

const none = { product: false, recent: false };

describe('Enter en el buscador', () => {
  it('con la búsqueda al día se puede elegir', () => {
    expect(resultsMatchTyped('apple', 'apple', none)).toBe(true);
    expect(resultsMatchTyped(' apple ', 'apple', none)).toBe(true);
  });

  it('con texto nuevo y los resultados del anterior, no se elige', () => {
    expect(resultsMatchTyped('apple inc', 'apple', none)).toBe(false);
    expect(resultsMatchTyped('a', 'apple', none)).toBe(false);
  });

  it('las bolsas de un producto y los recientes no dependen del texto', () => {
    expect(resultsMatchTyped('apple', 'iberdrola', { product: true, recent: false })).toBe(true);
    expect(resultsMatchTyped('', 'iberdrola', { product: false, recent: true })).toBe(true);
  });
});
