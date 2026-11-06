import { describe, expect, it } from 'vitest';
import { dispersionEllipse } from '@shared/domain/dispersion';
import { computeGaps } from '@shared/domain/gapping';
import { formatToPar, isGir, isScramble, scoreName } from '@shared/domain/golf';
import { mean, quantile, rate, sd } from '@shared/domain/stats';
import { fromDistance, toDistance, toSpeed } from '@shared/domain/units';

describe('stats', () => {
  it('handles empty and small inputs honestly', () => {
    expect(mean([])).toBeNull();
    expect(sd([5])).toBeNull();
    expect(rate(1, 0)).toBeNull();
  });
  it('computes sample sd and quantiles', () => {
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe('golf', () => {
  it('derives GIR and scrambling', () => {
    expect(isGir(4, 2, 4)).toBe(true); // on in 2 on a par 4
    expect(isGir(5, 2, 4)).toBe(false);
    expect(isGir(4, null, 4)).toBeNull();
    expect(isScramble(4, 1, 4)).toBe(true); // missed green, up and down for par
    expect(isScramble(4, 2, 4)).toBeNull(); // hit the green: not a scramble chance
  });
  it('names scores', () => {
    expect(scoreName(3, 5)).toBe('eagle');
    expect(scoreName(4, 4)).toBe('par');
    expect(scoreName(9, 4)).toBe('triple');
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(-2)).toBe('-2');
  });
});

describe('units', () => {
  it('round-trips distances', () => {
    expect(toDistance(0.9144, 'yards')).toBeCloseTo(1);
    expect(fromDistance(toDistance(150, 'yards'), 'yards')).toBeCloseTo(150);
    expect(toSpeed(44.704, 'mph')).toBeCloseTo(100, 1);
  });
});

describe('dispersion ellipse', () => {
  it('aligns with an elongated cloud', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: (i - 25) * 2, y: (i % 5) - 2 }));
    const e = dispersionEllipse(pts);
    expect(e).not.toBeNull();
    expect(e!.rx).toBeGreaterThan(e!.ry * 5);
    expect(Math.abs(e!.angleDeg) % 180).toBeLessThan(5);
  });
  it('needs three points', () => {
    expect(dispersionEllipse([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('gapping', () => {
  it('orders by loft and flags tight, wide and overlapping gaps', () => {
    const gaps = computeGaps([
      { clubId: 3, label: '9i', loftDeg: 40, carryM: 110 },
      { clubId: 1, label: '7i', loftDeg: 31, carryM: 133 },
      { clubId: 2, label: '8i', loftDeg: 35, carryM: 129 },
      { clubId: 4, label: 'PW', loftDeg: 45, carryM: 111 },
      { clubId: 5, label: 'GW', loftDeg: 50, carryM: null },
    ]);
    expect(gaps.map((g) => g.status)).toEqual(['tight', 'wide', 'overlap']);
  });
});
