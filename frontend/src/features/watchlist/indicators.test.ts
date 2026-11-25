import { describe, expect, it } from 'vitest';
import type { Candle } from '@/shared';
import {
  atr, bollinger, cci, demaS, donchian, emaS, fmtVolume, hasVolume, hmaS, ichimoku, INDICATOR_DEFS, macd, normalizeIndicator, psar, roc, rsi, smaS,
  stochastic, williamsR, wmaS,
} from './indicators.ts';

const bar = (c: number, i: number, spread = 1): Candle => ({ t: `2024-01-${String(i + 1).padStart(2, '0')}`, o: c, h: c + spread, l: c - spread, c });
const up = Array.from({ length: 30 }, (_, i) => bar(10 + i, i));
const closes = up.map((b) => b.c);

describe('medias', () => {
  it('SMA, EMA y WMA', () => {
    expect(smaS([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(emaS([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(wmaS([1, 2, 3], 3)).toEqual([null, null, (1 + 4 + 9) / 6]);
  });
  it('se saltan los huecos del principio', () => {
    expect(smaS([null, 2, 4], 2)).toEqual([null, null, 3]);
    expect(emaS([null, null, 2, 4, 6], 2)).toEqual([null, null, null, 3, 5]);
  });
  it('HMA y DEMA siguen una recta sin retraso', () => {
    expect(hmaS(closes, 9).at(-1)).toBeCloseTo(39, 6);
    expect(demaS(closes, 5).at(-1)).toBeCloseTo(39, 6);
  });
});

describe('bandas', () => {
  it('Bollinger con precio fijo se cierra en la media', () => {
    const b = bollinger([5, 5, 5], 2, 2);
    expect(b.upper).toEqual([null, 5, 5]);
    expect(b.lower).toEqual([null, 5, 5]);
  });
  it('Bollinger usa la desviación de la población', () => {
    expect(bollinger([1, 3], 2, 1).upper[1]).toBe(3);
  });
  it('Donchian: máximo y mínimo del periodo', () => {
    const d = donchian(up, 3);
    expect(d.upper[2]).toBe(13);
    expect(d.lower[2]).toBe(9);
    expect(d.mid[2]).toBe(11);
  });
  it('Ichimoku desplaza la nube y la chikou', () => {
    const k = ichimoku(up, 9, 26, 52);
    expect(k.tenkan[8]).toBe(14);
    expect(k.chikou[0]).toBe(up[26]!.c);
    expect(k.chikou.at(-1)).toBeNull();
    expect(k.spanA.slice(0, 26).every((v) => v == null)).toBe(true);
  });
  it('SAR por debajo en subida y se da la vuelta al caer', () => {
    const s = psar(up, 0.02, 0.2);
    expect(s.slice(1).every((v, i) => v! < up[i + 1]!.l)).toBe(true);
    const down = [...up, ...Array.from({ length: 5 }, (_, i) => bar(30 - i * 5, 30 + i))];
    expect(psar(down, 0.02, 0.2).at(-1)!).toBeGreaterThan(down.at(-1)!.h);
  });
});

describe('osciladores', () => {
  it('RSI: 100 si solo sube, 50 si no se mueve', () => {
    expect(rsi(closes, 14).at(-1)).toBe(100);
    expect(rsi(Array(20).fill(5), 14).at(-1)).toBe(50);
    expect(rsi(closes, 14)[13]).toBeNull();
    expect(rsi(closes, 14)[14]).toBe(100);
  });
  it('MACD: histograma = línea − señal', () => {
    const m = macd(closes, 3, 6, 2);
    const i = closes.length - 1;
    expect(m.hist[i]).toBeCloseTo(m.macd[i]! - m.signal[i]!, 9);
    expect(m.macd[i]).toBeGreaterThan(0);
  });
  it('Estocástico, Williams %R y CCI en los extremos', () => {
    expect(stochastic(up, 5, 1, 1).k.at(-1)).toBeCloseTo((100 * 5) / 6, 6);
    expect(williamsR(up, 5).at(-1)).toBeCloseTo((-100 * 1) / 6, 6);
    expect(cci(up, 5).at(-1)).toBeGreaterThan(100);
  });
  it('ROC en %', () => {
    expect(roc([10, 11, 12], 2)).toEqual([null, null, 20]);
  });
  it('ATR de velas iguales es su rango', () => {
    expect(atr(up.map((b) => ({ ...b, c: 10, h: 11, l: 9 })), 5).at(-1)).toBe(2);
  });
});

describe('volumen', () => {
  it('pinta el volumen de cada vela con su media y deja huecos donde no hay', () => {
    const bars = [{ ...bar(10, 0), v: 100 }, { ...bar(11, 1), v: 300 }, { ...bar(12, 2), v: null }, { ...bar(13, 3), v: 200 }];
    const out = INDICATOR_DEFS.volume.compute(bars, { n: 2 });
    expect(out.v).toEqual([100, 300, null, 200]);
    expect(out.ma).toEqual([null, 200, null, null]);
  });
  it('sabe si hay volumen y lo abrevia', () => {
    expect(hasVolume(up)).toBe(false);
    expect(hasVolume([{ ...bar(10, 0), v: 0 }, { ...bar(10, 1), v: 5 }])).toBe(true);
    expect(fmtVolume(18_612_987)).toBe('18,61 M');
  });
});

describe('catálogo', () => {
  it('cada indicador devuelve todas sus líneas con una cifra por vela', () => {
    for (const def of Object.values(INDICATOR_DEFS)) {
      const p = Object.fromEntries(def.params.map((x) => [x.key, x.def]));
      const out = def.compute(up, p);
      for (const l of def.lines) expect(out[l.key], `${def.kind}.${l.key}`).toHaveLength(up.length);
    }
  });
  it('lee el formato antiguo y recorta parámetros', () => {
    expect(normalizeIndicator({ id: 'a', kind: 'ema', period: 50, color: '#fff' })).toEqual({ id: 'a', kind: 'ema', params: { n: 50 }, color: '#fff' });
    expect(normalizeIndicator({ id: 'b', kind: 'bb', params: { n: 9999 }, color: '#fff', hidden: true })).toEqual({ id: 'b', kind: 'bb', params: { n: 500, k: 2 }, color: '#fff', hidden: true });
    expect(normalizeIndicator({ id: 'c', kind: 'vwap', color: '#fff' })).toBeNull();
  });
});
