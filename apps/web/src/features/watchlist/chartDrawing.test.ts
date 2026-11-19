import { describe, expect, it } from 'vitest';
import { addWeekdays, channelOffset, distToSegment, fromLogical, insidePolygon, toLogical, weekdaysBetween } from './chartDrawing.ts';

// Jueves 13 a miércoles 19 de noviembre de 2026, sin el fin de semana.
const dates = ['2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];

describe('geometría del gráfico de velas', () => {
  it('cuenta días laborables en los dos sentidos', () => {
    expect(weekdaysBetween('2026-11-13', '2026-11-16')).toBe(1);
    expect(weekdaysBetween('2026-11-16', '2026-11-13')).toBe(-1);
    expect(addWeekdays('2026-11-19', 2)).toBe('2026-11-23');
    expect(addWeekdays('2026-11-13', -1)).toBe('2026-11-12');
  });

  it('pasa fechas a posiciones y vuelta, también fuera de los datos', () => {
    expect(toLogical(dates, '2026-11-17')).toBe(2);
    expect(toLogical(dates, '2026-11-23')).toBe(6);
    expect(toLogical(dates, '2026-11-11')).toBe(-2);
    expect(fromLogical(dates, 2.4)).toBe('2026-11-17');
    expect(fromLogical(dates, 6)).toBe('2026-11-23');
    expect(fromLogical(dates, -2)).toBe('2026-11-11');
  });

  it('la paralela del canal se separa lo que marca el tercer punto', () => {
    const a = { t: '2026-11-13', p: 10 };
    const b = { t: '2026-11-17', p: 12 };
    expect(channelOffset(dates, [a, b, { t: '2026-11-16', p: 14 }])).toBeCloseTo(3);
  });

  it('mide la distancia a un segmento', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(13, 4, 0, 0, 10, 0)).toBe(5);
  });

  it('sabe si un clic cae dentro de un canal', () => {
    const quad: [number, number][] = [[0, 0], [10, 2], [10, 8], [0, 6]];
    expect(insidePolygon(5, 4, quad)).toBe(true);
    expect(insidePolygon(5, 9, quad)).toBe(false);
  });
});
