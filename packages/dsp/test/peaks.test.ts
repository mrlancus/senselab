import { describe, expect, it } from 'vitest';
import { argMax, findPeaks, parabolicPeak } from '../src';

describe('peaks', () => {
  it('parabolic interpolation finds the true vertex', () => {
    const f = (x: number) => -((x - 0.3) ** 2) + 5;
    const { offset, value } = parabolicPeak(f(-1), f(0), f(1));
    expect(offset).toBeCloseTo(0.3, 12);
    expect(value).toBeCloseTo(5, 12);
    expect(parabolicPeak(1, 1, 1)).toEqual({ offset: 0, value: 1 });
  });

  it('finds, sorts and filters local maxima', () => {
    const y = [0, 3, 0, 1, 0, 5, 4, 5.2, 0, 2, 2, 2, 0];
    const peaks = findPeaks(y);
    expect(peaks.map((p) => p.index)).toEqual([7, 5, 1, 10, 3]);
    expect(findPeaks(y, { minHeight: 2.5 }).map((p) => p.index)).toEqual([7, 5, 1]);
    expect(findPeaks(y, { minDistance: 3 }).map((p) => p.index)).toEqual([7, 1, 10]);
    expect(findPeaks(y, { maxPeaks: 2 })).toHaveLength(2);
  });

  it('computes prominence', () => {
    const y = [0, 3, 0, 1, 0, 5, 4, 5.2, 0];
    const byIndex = Object.fromEntries(findPeaks(y).map((p) => [p.index, p.prominence]));
    expect(byIndex[7]).toBeCloseTo(5.2);
    expect(byIndex[5]).toBeCloseTo(1);
    expect(byIndex[3]).toBeCloseTo(1);
    expect(findPeaks(y, { minProminence: 2 }).map((p) => p.index)).toEqual([7, 1]);
  });

  it('respects start/end and ignores rising plateaus', () => {
    expect(findPeaks([0, 5, 0, 1, 2, 2, 3, 0], { start: 2 }).map((p) => p.index)).toEqual([6]);
    expect(argMax([1, 9, 3, 9])).toBe(1);
    expect(argMax([1, 9, 3, 10], 2)).toBe(3);
  });
});
