import { describe, expect, it } from 'vitest';
import {
  analyzeTaps,
  ASSUMED_K,
  ASSUMED_K_RANGE,
  estimateLitresFromTaps,
  fitTapCalibration,
  summarizeTaps,
  type TapReading,
} from '../src';
import { addNoise, decayingSine, mixDelayed, SR } from './synth';

/** A synthetic "bucket": pitch follows (f₀/f)² = 1 + α·V^k. */
const bucket = { f0: 820, alpha: 0.012, k: 1.6, capacity: 12 };
const pitchAt = (litres: number) => bucket.f0 / Math.sqrt(1 + bucket.alpha * litres ** bucket.k);

/** A few taps on the bucket: the fundamental plus a weaker higher mode and an impact click. */
function tapRecording(freq: number, opts: { taps?: number; jitter?: number; seed?: number } = {}) {
  const n = opts.taps ?? 4;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const f = freq * (1 + (opts.jitter ?? 0) * ((i % 3) - 1));
    const mode1 = decayingSine(f, { tau: 0.035, amp: 0.3, totalS: 0.3 });
    const mode2 = decayingSine(f * 2.7, { tau: 0.015, amp: 0.08, totalS: 0.3 });
    const tap = mode1.map(
      (v, j) => v + mode2[j] + (j < 24 ? 0.4 * (1 - j / 24) * (j % 2 ? 1 : -1) : 0),
    );
    parts.push({ src: tap, delay: Math.round((0.3 + i * 0.55) * SR) });
  }
  return addNoise(mixDelayed(Math.round((0.6 + n * 0.55) * SR), parts), 0.004, opts.seed ?? 1);
}

describe('tap analysis', () => {
  it('finds every tap and its pitch despite the impact click and a second mode', () => {
    const { taps } = analyzeTaps(tapRecording(733.3), SR);
    expect(taps).toHaveLength(4);
    for (const t of taps) expect(Math.abs(t.frequency - 733.3)).toBeLessThan(1.5);
  });

  it('summary rejects a tap that rang a different mode', () => {
    const t = (frequency: number): TapReading => ({
      onsetS: 0,
      frequency,
      snrDb: 30,
      q: 20,
      resonance: { frequency, magnitudeDb: 0, snrDb: 30, bandwidthHz: 10, q: 20, peaks: [] },
    });
    const s = summarizeTaps([t(700), t(702), t(698), t(1890)])!;
    expect(s.frequency).toBeCloseTo(700, 5);
    expect(s.used).toBe(3);
    expect(s.rejected).toBe(1);
    expect(s.spreadHz).toBeGreaterThan(0);
    expect(summarizeTaps([])).toBeNull();
    expect(summarizeTaps([t(500)])!.spreadHz).toBe(0);
  });
});

describe('tap calibration', () => {
  const cal = [0, 5, 10].map((litres) => ({ litres, frequency: pitchAt(litres) }));

  it('recovers the power law from empty / half / full', () => {
    const fit = fitTapCalibration(cal);
    expect(fit.model.kind).toBe('power');
    if (fit.model.kind === 'power') {
      expect(fit.model.k).toBeCloseTo(bucket.k, 6);
      expect(fit.model.alpha).toBeCloseTo(bucket.alpha, 6);
    }
    for (const l of [1, 2.5, 7.5, 9]) expect(fit.predict(pitchAt(l))).toBeCloseTo(l, 6);
    expect(fit.predict(900)).toBe(0);
    expect(fit.residualRmsLitres).toBeLessThan(1e-9);
    expect(fit.searchBand[0]).toBeLessThan(fit.rangeHz[0]);
  });

  it('two points (empty + one) assume k = 2 and report the shape uncertainty', () => {
    const fit = fitTapCalibration(cal.slice(0, 2));
    expect(fit.model.kind).toBe('power');
    if (fit.model.kind === 'power') {
      expect(fit.model.k).toBe(ASSUMED_K);
      expect(fit.model.kRange).toEqual(ASSUMED_K_RANGE);
    }
    expect(fit.predict(pitchAt(5))).toBeCloseTo(5, 6);
    expect(fit.predict(pitchAt(2))).toBeGreaterThan(0);
    expect(fit.predict(pitchAt(2))).toBeLessThan(5);

    const at = (l: number) =>
      estimateLitresFromTaps(
        fit,
        { frequency: pitchAt(l), spreadHz: 0.5, used: 5, rejected: 0, snrDb: 40 },
        bucket.capacity,
      );
    // At the calibrated fill the shape doesn't matter; away from it the ± covers the truth.
    expect(at(5).shapeUncertaintyLitres).toBeLessThan(1e-6);
    for (const l of [1.5, 2.5, 8]) {
      const e = at(l);
      expect(e.shapeUncertaintyLitres).toBeGreaterThan(0.1);
      expect(Math.abs(e.litres - l)).toBeLessThanOrEqual(e.uncertaintyLitres);
    }
    expect(at(2.5).confidence).toBeLessThan(at(5).confidence);
  });

  it('three points measure k, so there is no shape uncertainty', () => {
    const fit = fitTapCalibration(cal);
    const e = estimateLitresFromTaps(
      fit,
      { frequency: pitchAt(2.5), spreadHz: 0.5, used: 5, rejected: 0, snrDb: 40 },
      bucket.capacity,
    );
    expect(e.shapeUncertaintyLitres).toBe(0);
  });

  it('without an empty point falls back to monotone interpolation', () => {
    const fit = fitTapCalibration([
      { litres: 2, frequency: pitchAt(2) },
      { litres: 6, frequency: pitchAt(6) },
      { litres: 10, frequency: pitchAt(10) },
    ]);
    expect(fit.model.kind).toBe('interp');
    expect(Math.abs(fit.predict(pitchAt(4)) - 4)).toBeLessThan(0.4);
  });

  it('falls back when pitch rises with fill, and merges repeated fills', () => {
    const fit = fitTapCalibration([
      { litres: 0, frequency: 500 },
      { litres: 4, frequency: 560 },
      { litres: 4, frequency: 562 },
      { litres: 8, frequency: 600 },
    ]);
    expect(fit.model.kind).toBe('interp');
    expect(fit.predict(561)).toBeCloseTo(4, 6);
  });

  it('refuses unusable calibrations', () => {
    expect(() => fitTapCalibration([{ litres: 0, frequency: 800 }])).toThrow(/two/);
    expect(() =>
      fitTapCalibration([
        { litres: 0, frequency: 800 },
        { litres: 5, frequency: 795 }, // 0.6%: below MIN_PITCH_CHANGE
      ]),
    ).toThrow(/same pitch/);
  });
});

describe('end to end: synthetic bucket', () => {
  it('calibrate with recordings at 0/5/10 L, then measure 7.5 L within 0.3 L', () => {
    const measure = (litres: number, seed: number) =>
      summarizeTaps(analyzeTaps(tapRecording(pitchAt(litres), { jitter: 0.0015, seed }), SR).taps)!;
    const fit = fitTapCalibration(
      [0, 5, 10].map((litres, i) => ({ litres, frequency: measure(litres, 10 + i).frequency })),
    );
    const est = estimateLitresFromTaps(fit, measure(7.5, 99), bucket.capacity);
    expect(Math.abs(est.litres - 7.5)).toBeLessThan(0.3);
    expect(est.inRange).toBe(true);
    expect(est.confidence).toBeGreaterThan(0.5);
    expect(est.uncertaintyLitres).toBeGreaterThan(0);
    expect(est.uncertaintyLitres).toBeLessThan(1);
  });

  it('flags out-of-range and inconsistent measurements with low confidence', () => {
    const fit = fitTapCalibration([0, 5].map((litres) => ({ litres, frequency: pitchAt(litres) })));
    const est = estimateLitresFromTaps(fit, {
      frequency: pitchAt(11),
      spreadHz: 25,
      used: 2,
      rejected: 3,
      snrDb: 12,
    });
    expect(est.inRange).toBe(false);
    expect(est.confidence).toBeLessThan(0.1);
    expect(est.litres).toBeLessThanOrEqual(5 * 1.25);
  });
});
