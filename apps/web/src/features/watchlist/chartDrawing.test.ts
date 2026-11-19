import { describe, expect, it } from 'vitest';
import type { Candle, ChartDrawing } from '@watchlist/shared';
import {
  addWeekdays, aggregate, channelOffset, distToSegment, dragHandle, ema, fromLogical, insidePolygon, isIntraday, moveDrawing,
  periodBase, periodReturn, sma, snapPrice, toLogical, weekdaysBetween,
} from './chartDrawing.ts';

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

const candle = (t: string, c: number, o = c, h = c, l = c): Candle => ({ t, o, h, l, c }) as Candle;

describe('intervalos, medias y periodos', () => {
  it('agrega velas semanales y mensuales', () => {
    const daily = [candle('2026-10-29', 10, 9, 11, 8), candle('2026-10-30', 12, 10, 13, 9), candle('2026-11-02', 11, 12, 14, 10), candle('2026-11-03', 15, 11, 16, 7)];
    const weeks = aggregate(daily, 'W');
    expect(weeks.map((w) => [w.t, w.o, w.h, w.l, w.c])).toEqual([['2026-10-29', 9, 13, 8, 12], ['2026-11-02', 12, 16, 7, 15]]);
    expect(aggregate(daily, 'M').map((m) => m.t)).toEqual(['2026-10-29', '2026-11-02']);
    expect(daily[0]!.c).toBe(10);
  });

  it('sitúa fechas en barras semanales y mensuales', () => {
    const weeks = ['2026-11-02', '2026-11-09', '2026-11-16'];
    expect(toLogical(weeks, '2026-11-11', 'W')).toBe(1);
    expect(toLogical(weeks, '2026-11-30', 'W')).toBe(4);
    expect(fromLogical(weeks, 4, 'W')).toBe('2026-11-30');
    const months = ['2026-09-01', '2026-10-01', '2026-11-02'];
    expect(toLogical(months, '2026-10-15', 'M')).toBe(1);
    expect(fromLogical(months, 4, 'M')).toBe('2027-01-01');
    expect(fromLogical(months, -1, 'M')).toBe('2026-08-01');
  });

  it('calcula medias simples y exponenciales', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(ema([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(ema([2, 2, 5], 2)[2]).toBeCloseTo(4);
  });

  it('pega el precio a la vela con el imán', () => {
    expect(snapPrice(candle('2026-11-19', 10, 9, 12, 8), 11.4)).toBe(12);
    expect(snapPrice(candle('2026-11-19', 10, 9, 12, 8), 9.6)).toBe(10);
  });

  it('mide la rentabilidad de cada periodo', () => {
    const cs = [candle('2025-11-18', 50), candle('2025-12-31', 80), candle('2026-01-02', 90), candle('2026-11-18', 95), candle('2026-11-19', 100)];
    expect(periodBase(cs, '1d')).toBe(3);
    expect(periodBase(cs, '1y')).toBe(0);
    expect(periodReturn(cs, 'ytd')).toBeCloseTo(0.25);
    expect(periodReturn(cs, 'max')).toBeCloseTo(1);
    expect(periodBase(cs, '3y')).toBeNull();
    expect(periodBase([], 'max')).toBeNull();
  });
});

describe('edición de dibujos', () => {
  const trend: ChartDrawing = { id: 'a', type: 'trend', points: [{ t: '2026-11-13', p: 10 }, { t: '2026-11-17', p: 12 }] };
  it('mueve un dibujo en barras y precio', () => {
    expect(moveDrawing(trend, 1, 0.5, dates, 'D').points).toEqual([{ t: '2026-11-16', p: 10.5 }, { t: '2026-11-18', p: 12.5 }]);
    const h: ChartDrawing = { id: 'h', type: 'hline', points: [{ t: '1970-01-01', p: 10 }] };
    expect(moveDrawing(h, 3, 1, dates, 'D').points).toEqual([{ t: '1970-01-01', p: 11 }]);
    const v: ChartDrawing = { id: 'v', type: 'vline', points: [{ t: '2026-11-16', p: 10 }] };
    expect(moveDrawing(v, 1, 5, dates, 'D').points).toEqual([{ t: '2026-11-17', p: 10 }]);
  });

  it('arrastra un punto, y el stop de una posición solo en precio', () => {
    expect(dragHandle(trend, 1, { t: '2026-11-19', p: 13 }).points[1]).toEqual({ t: '2026-11-19', p: 13 });
    const long: ChartDrawing = { id: 'l', type: 'long', points: [{ t: '2026-11-13', p: 10 }, { t: '2026-11-19', p: 11 }, { t: '2026-11-13', p: 9 }] };
    expect(dragHandle(long, 2, { t: '2026-11-18', p: 8.5 }).points[2]).toEqual({ t: '2026-11-13', p: 8.5 });
  });
});

describe('velas intradía', () => {
  const dates = ['2026-10-01T13:30Z', '2026-10-01T13:35Z', '2026-10-01T13:40Z', '2026-10-02T13:30Z'];

  it('sitúa cada punto en la vela que lo contiene y cuenta velas fuera de los datos', () => {
    expect(isIntraday('5m')).toBe(true);
    expect(isIntraday('D')).toBe(false);
    expect(toLogical(dates, '2026-10-01T13:35Z', '5m')).toBe(1);
    expect(toLogical(dates, '2026-10-01T13:37Z', '5m')).toBe(1);
    expect(toLogical(dates, '2026-10-02T13:45Z', '5m')).toBe(6);
    expect(toLogical(dates, '2026-10-01T13:20Z', '5m')).toBe(-2);
    // Un punto dibujado en diario cae en la primera vela de su día.
    expect(toLogical(dates, '2026-10-02', '5m')).toBe(3);
  });

  it('pasa de posición a fecha y hora, también más allá de la última vela', () => {
    expect(fromLogical(dates, 2, '5m')).toBe('2026-10-01T13:40Z');
    expect(fromLogical(dates, 5, '5m')).toBe('2026-10-02T13:40Z');
    expect(fromLogical(dates, -1, '5m')).toBe('2026-10-01T13:25Z');
  });

  it('en diario, un punto con hora cae en la vela de su día', () => {
    expect(toLogical(['2026-10-01', '2026-10-02', '2026-10-05'], '2026-10-02T15:00Z', 'D')).toBe(1);
  });
});
