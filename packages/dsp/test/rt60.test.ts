import { describe, expect, it } from 'vitest';
import {
  analyzeDecay,
  analyzeRoom,
  bandpassBiquad,
  biquadFilter,
  createRng,
  octaveBand,
  rms,
  tone,
} from '../src';
import { SR } from './synth';

/**
 * A synthetic room: an impulse followed by Gaussian noise whose energy decays by 60 dB in
 * `rt` seconds (amplitude ∝ 10^(−3t/rt)), on top of steady background noise.
 */
function room(
  rt: number,
  opts: { preS?: number; totalS?: number; floor?: number; seed?: number } = {},
) {
  const rng = createRng(opts.seed ?? 5);
  const pre = Math.round((opts.preS ?? 0.5) * SR);
  const n = Math.round((opts.totalS ?? 3) * SR);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (opts.floor ?? 1e-4) * rng.gaussian();
    if (i >= pre) {
      const t = (i - pre) / SR;
      x[i] += 0.5 * Math.pow(10, (-3 * t) / rt) * rng.gaussian();
    }
  }
  return x;
}

describe('filters', () => {
  it('band-pass has unity gain at the centre and attenuates an octave away', () => {
    const gainAt = (f: number) => {
      const y = biquadFilter(tone(f, 0.5, SR), bandpassBiquad(1000, Math.SQRT2, SR));
      return rms(y, SR * 0.2, SR * 0.4) / (1 / Math.SQRT2);
    };
    expect(gainAt(1000)).toBeCloseTo(1, 2);
    expect(gainAt(4000)).toBeLessThan(0.45);
    const two = (f: number) =>
      rms(octaveBand(tone(f, 0.5, SR), 1000, SR), SR * 0.2, SR * 0.4) / (1 / Math.SQRT2);
    expect(two(1000)).toBeCloseTo(1, 2);
    expect(two(250)).toBeLessThan(0.12);
  });
});

describe('decay analysis', () => {
  it('recovers a known RT60 (T20, T30, EDT) from an exponential decay', () => {
    for (const rt of [0.3, 0.8, 1.6]) {
      const x = room(rt, { preS: 0, totalS: Math.max(2, rt * 2) });
      const d = analyzeDecay(x, SR, 1e-8);
      expect(d.t20!.seconds / rt, `T20 for ${rt}`).toBeGreaterThan(0.95);
      expect(d.t20!.seconds / rt, `T20 for ${rt}`).toBeLessThan(1.05);
      expect(Math.abs(d.t30!.seconds / rt - 1)).toBeLessThan(0.05);
      expect(Math.abs(d.edt!.seconds / rt - 1)).toBeLessThan(0.1);
      expect(d.t20!.r2).toBeGreaterThan(0.99);
    }
  });

  it('noise compensation keeps T30 right when the noise floor is only 50 dB down', () => {
    const rt = 0.8;
    const x = room(rt, { preS: 0, floor: 0.5 * 10 ** (-50 / 20) });
    const d = analyzeDecay(x, SR);
    expect(d.dynamicRangeDb).toBeGreaterThan(45);
    expect(d.dynamicRangeDb).toBeLessThan(55);
    expect(Math.abs(d.t30!.seconds / rt - 1)).toBeLessThan(0.08);
    expect(d.truncationS).toBeLessThan(1);
  });

  it('refuses T30 (and T20) when the dynamic range is too small', () => {
    const x = room(0.8, { preS: 0, floor: 0.5 * 10 ** (-30 / 20) });
    const d = analyzeDecay(x, SR);
    expect(d.t30).toBeNull();
    expect(d.t20).toBeNull();
    expect(d.edt).not.toBeNull();
  });
});

describe('room analysis', () => {
  it('finds the clap and reports per-band and overall RT60', () => {
    const rt = 0.6;
    const a = analyzeRoom(room(rt, { preS: 0.7, totalS: 3 }), SR);
    expect(a.onsetS).toBeGreaterThan(0.68);
    expect(a.onsetS).toBeLessThan(0.71);
    expect(a.bands.map((b) => b.fc)).toEqual([250, 500, 1000, 2000, 4000, 8000]);
    for (const b of a.bands) {
      // Within 2.5× the expected single-impulse scatter (≈ 10% at 250 Hz, 2.5% at 4 kHz).
      expect(b.scatter!).toBeCloseTo(1 / Math.sqrt(0.71 * b.fc * b.t20!.seconds), 9);
      expect(Math.abs(b.t20!.seconds / rt - 1), `${b.fc} Hz`).toBeLessThan(2.5 * b.scatter!);
    }
    expect(Math.abs(a.rt60! / rt - 1)).toBeLessThan(0.05);
  });

  it('returns nothing for silence', () => {
    const a = analyzeRoom(new Float64Array(SR), SR);
    expect(a.onsetS).toBeNull();
    expect(a.rt60).toBeNull();
  });
});
