import { describe, expect, it } from 'vitest';
import {
  calibrateCompass,
  compassAnomaly,
  createRng,
  detectAnomaly,
  fieldBaseline,
  fieldMagnitude,
  integrateYaw,
  unwrapDegrees,
  type CompassSample,
} from '../src';

/**
 * A phone at 60 Hz: it turns (yaw(t)), and near t = `metalAt` a steel object bends the field,
 * adding `bumpDeg` to the compass for ~0.5 s. `sign` flips the browser's yaw-rate convention.
 */
function sweep(
  opts: {
    seconds?: number;
    turn?: (t: number) => number;
    metalAt?: number;
    bumpDeg?: number;
    sign?: 1 | -1;
    seed?: number;
  } = {},
) {
  const rng = createRng(opts.seed ?? 1);
  const turn = opts.turn ?? ((t: number) => 25 * Math.sin(1.3 * t));
  const out: CompassSample[] = [];
  const dt = 1 / 60;
  for (let i = 0; i < (opts.seconds ?? 6) * 60; i++) {
    const t = i * dt;
    const rate = (turn(t + 1e-4) - turn(t - 1e-4)) / 2e-4;
    const bump =
      opts.metalAt != null
        ? (opts.bumpDeg ?? 15) * Math.exp(-(((t - opts.metalAt) / 0.25) ** 2))
        : 0;
    const heading = (((200 + turn(t) + bump + 0.4 * rng.gaussian()) % 360) + 360) % 360;
    out.push({ t, heading, yawRate: (opts.sign ?? 1) * rate + 0.5 * rng.gaussian() });
  }
  return out;
}

describe('compass helpers', () => {
  it('unwraps headings across 0/360', () => {
    expect(unwrapDegrees([350, 355, 2, 8, 359])).toEqual([350, 355, 362, 368, 359]);
  });
  it('integrates the yaw rate', () => {
    const s = [0, 1, 2].map((t) => ({ t, heading: 0, yawRate: 10 }));
    expect(integrateYaw(s)).toEqual([0, 10, 20]);
  });
});

describe('compass-minus-gyro metal finder', () => {
  it('fits the gyro gain and sign while turning away from metal', () => {
    for (const sign of [1, -1] as const) {
      const c = calibrateCompass(sweep({ sign }));
      expect(c.k).toBeCloseTo(sign, 1);
      expect(c.turnedDeg).toBeGreaterThan(40);
      expect(c.noiseDeg).toBeLessThan(1.5);
    }
  });

  it('assumes k = 1 when the phone barely turned', () => {
    const c = calibrateCompass(sweep({ turn: () => 0 }));
    expect(c.k).toBe(1);
    expect(c.turnedDeg).toBeLessThan(20);
  });

  it('finds a steel object while the phone is also turning', () => {
    const cal = calibrateCompass(sweep({ seed: 2 }));
    const live = sweep({
      metalAt: 3,
      bumpDeg: 15,
      seed: 3,
      turn: (t) => 30 * Math.sin(0.9 * t + 1),
    });
    const a = compassAnomaly(live, cal.k);
    const at = (t: number) => a[Math.round(t * 60)];
    expect(detectAnomaly(at(3), cal.noiseDeg).detected).toBe(true);
    expect(Math.abs(at(3) - 15)).toBeLessThan(3);
    expect(detectAnomaly(at(0.5), cal.noiseDeg).detected).toBe(false);
    expect(detectAnomaly(at(5.5), cal.noiseDeg).detected).toBe(false);
    // The raw heading alone swings by ±30° from the turning and can't tell.
    expect(Math.max(...unwrapDegrees(live.map((s) => s.heading))) - 200).toBeGreaterThan(25);
  });
});

describe('field magnitude', () => {
  it('baseline and detection in µT', () => {
    const rng = createRng(4);
    const quiet = Array.from(
      { length: 120 },
      () => fieldMagnitude(20, 30, -35) + 0.3 * rng.gaussian(),
    );
    const b = fieldBaseline(quiet);
    expect(b.mean).toBeCloseTo(Math.hypot(20, 30, -35), 0);
    expect(b.noise).toBeGreaterThan(0.2);
    expect(b.noise).toBeLessThan(0.45);
    expect(detectAnomaly(fieldMagnitude(20, 30, -35) + 5 - b.mean, b.noise).detected).toBe(true);
    expect(detectAnomaly(0.5, b.noise).detected).toBe(false);
    expect(detectAnomaly(100, b.noise).level).toBe(1);
  });
});
