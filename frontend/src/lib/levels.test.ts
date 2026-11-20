import { describe, expect, it } from 'vitest';
import { shiftLevels } from './levels.ts';

describe('shiftLevels', () => {
  it('quita el nivel comprado (el más cercano a la orden) y sube los demás', () => {
    expect(shiftLevels([61, 55, 50], 61.2)).toEqual([55, 50]);
    expect(shiftLevels([61, 55, 50], 55)).toEqual([61, 50]);
    expect(shiftLevels([61], 64)).toEqual([]);
    expect(shiftLevels([], 10)).toEqual([]);
  });
});
