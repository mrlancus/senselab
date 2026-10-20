import { describe, expect, it } from 'vitest';
import { frustumCapacityLitres, frustumLevelForLitres, frustumLitresAtLevel } from '../src';

describe('frustum geometry', () => {
  it('matches the cylinder formula when diameters are equal', () => {
    const cyl = { topDiameterCm: 20, bottomDiameterCm: 20, heightCm: 30 };
    expect(frustumCapacityLitres(cyl)).toBeCloseTo((Math.PI * 10 * 10 * 30) / 1000, 9);
    expect(frustumLitresAtLevel(cyl, 15)).toBeCloseTo((Math.PI * 100 * 15) / 1000, 9);
  });

  it('gives a typical 10 L bucket about 10 L', () => {
    const bucket = { topDiameterCm: 28, bottomDiameterCm: 22, heightCm: 21 };
    expect(frustumCapacityLitres(bucket)).toBeGreaterThan(9.5);
    expect(frustumCapacityLitres(bucket)).toBeLessThan(10.8);
  });

  it('clamps levels outside the container', () => {
    const f = { topDiameterCm: 30, bottomDiameterCm: 20, heightCm: 25 };
    expect(frustumLitresAtLevel(f, -5)).toBe(0);
    expect(frustumLitresAtLevel(f, 100)).toBeCloseTo(frustumCapacityLitres(f), 12);
  });

  it('inverts level ↔ litres', () => {
    const f = { topDiameterCm: 30, bottomDiameterCm: 20, heightCm: 25 };
    for (const level of [0.5, 5, 12.3, 24.9]) {
      expect(frustumLevelForLitres(f, frustumLitresAtLevel(f, level))).toBeCloseTo(level, 6);
    }
    expect(frustumLevelForLitres(f, 0)).toBe(0);
    expect(frustumLevelForLitres(f, 1e6)).toBe(25);
  });
});
