import { expect, it } from 'vitest';
import { periodStart } from './historyRange.ts';

it('selecciona meses y años naturales ajustando finales de mes, bisiestos y primera operación', () => {
  expect(periodStart('1m', '2026-03-31', '2020-01-01')).toBe('2026-02-28');
  expect(periodStart('1y', '2024-02-29', '2020-01-01')).toBe('2023-02-28');
  expect(periodStart('2y', '2026-11-11', '2020-01-01')).toBe('2024-11-11');
  expect(periodStart('5y', '2026-11-11', '2025-03-01')).toBe('2025-03-01');
  expect(periodStart('all', '2026-11-11', '2015-01-01')).toBe('2015-01-01');
  expect(periodStart('ytd', '2026-11-11', '2015-01-01')).toBe('2026-01-01');
  expect(periodStart('ytd', '2026-11-11', '2026-06-01')).toBe('2026-06-01');
});
