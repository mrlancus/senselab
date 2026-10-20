import { describe, expect, it } from 'vitest';
import { linearFit, linearInterpolator, pchip, polyEval, polyFit, solveLinear } from '../src';

describe('fitting', () => {
  it('solves linear systems', () => {
    expect(
      solveLinear(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ).map((v) => +v.toFixed(10)),
    ).toEqual([0.8, 1.4]);
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/Singular/);
  });

  it('linear fit recovers slope and intercept', () => {
    const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(f.slope).toBeCloseTo(2);
    expect(f.intercept).toBeCloseTo(1);
    expect(f.r2).toBeCloseTo(1);
    expect(linearFit([0, 1], [2, 2]).r2).toBe(1);
    expect(() => linearFit([1], [1])).toThrow();
    expect(() => linearFit([1, 1], [1, 2])).toThrow(/equal/);
  });

  it('polynomial fit recovers a quadratic', () => {
    const xs = [-2, -1, 0, 1, 2, 3];
    const ys = xs.map((x) => 1 - 2 * x + 0.5 * x * x);
    const c = polyFit(xs, ys, 2);
    expect(c[0]).toBeCloseTo(1, 9);
    expect(c[1]).toBeCloseTo(-2, 9);
    expect(c[2]).toBeCloseTo(0.5, 9);
    expect(polyEval(c, 4)).toBeCloseTo(1 - 8 + 8, 9);
    expect(() => polyFit([1, 2], [1, 2], 2)).toThrow();
  });

  it('linear interpolation extrapolates from end segments', () => {
    const f = linearInterpolator([2, 0, 1], [4, 0, 1]);
    expect(f(0.5)).toBeCloseTo(0.5);
    expect(f(1.5)).toBeCloseTo(2.5);
    expect(f(3)).toBeCloseTo(7);
    expect(f(-1)).toBeCloseTo(-1);
    expect(() => linearInterpolator([1, 1], [1, 2])).toThrow(/Duplicate/);
    expect(() => linearInterpolator([1], [1])).toThrow();
  });

  it('pchip passes through points and stays monotone', () => {
    const xs = [600, 700, 800, 900];
    const ys = [10, 7, 2, 0];
    const f = pchip(xs, ys);
    xs.forEach((x, i) => expect(f(x)).toBeCloseTo(ys[i], 12));
    let prev = Infinity;
    for (let x = 600; x <= 900; x += 1) {
      const y = f(x);
      expect(y).toBeLessThanOrEqual(prev + 1e-12);
      prev = y;
    }
    expect(f(1000)).toBeLessThan(0.001);
    expect(f(500)).toBeGreaterThanOrEqual(10);
  });

  it('pchip handles two points and local extrema', () => {
    expect(pchip([0, 1], [0, 2])(0.5)).toBeCloseTo(1);
    const f = pchip([0, 1, 2, 3], [0, 1, 0, 1]);
    expect(f(1)).toBeCloseTo(1);
    expect(f(0.5)).toBeLessThanOrEqual(1);
    expect(() => pchip([0], [0])).toThrow();
  });
});
