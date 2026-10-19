import { describe, expect, it } from 'vitest';
import { ampToDb, clamp, createRng, mad, maxAbs, mean, median, rms, toDb } from '../src';

describe('stats', () => {
  it('basic statistics', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNaN();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(rms([3, -3, 3, -3])).toBe(3);
    expect(rms([])).toBe(0);
    expect(maxAbs([1, -5, 2])).toBe(5);
    expect(toDb(100)).toBeCloseTo(20);
    expect(ampToDb(10)).toBeCloseTo(20);
    expect(clamp(5, 0, 1)).toBe(1);
  });

  it('seeded rng is deterministic and roughly normal', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(a.next()).toBe(b.next());
    const g = Array.from({ length: 20000 }, () => a.gaussian());
    expect(Math.abs(mean(g))).toBeLessThan(0.03);
    expect(Math.abs(rms(g) - 1)).toBeLessThan(0.03);
  });
});
