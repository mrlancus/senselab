import { describe, expect, it } from 'vitest';
import { createRng, detectAlarm, makeFingerprint, bandSpectrogram, matchFingerprint } from '../src';
import { SR } from './synth';

/** Beeps (start s, duration s, Hz) with soft edges, plus background noise. */
function beeps(
  list: [number, number, number][],
  totalS: number,
  opts: { noise?: number; gain?: number; seed?: number } = {},
) {
  const rng = createRng(opts.seed ?? 1);
  const x = new Float64Array(Math.round(totalS * SR));
  for (const [t0, d, f] of list) {
    const a = Math.round(t0 * SR);
    const n = Math.round(d * SR);
    const ramp = Math.round(0.005 * SR);
    for (let i = 0; i < n && a + i < x.length; i++) {
      const e = Math.min(1, i / ramp, (n - i) / ramp);
      x[a + i] += (opts.gain ?? 0.3) * e * Math.sin((2 * Math.PI * f * i) / SR);
    }
  }
  for (let i = 0; i < x.length; i++) x[i] += (opts.noise ?? 0.01) * rng.gaussian();
  return x;
}

const t3 = (start: number, f = 3200): [number, number, number][] =>
  [0, 1, 2].map((k) => [start + k, 0.5, f]);
const t4 = (start: number, f = 3400): [number, number, number][] =>
  [0, 1, 2, 3].map((k) => [start + 0.2 * k, 0.1, f]);

describe('smoke and CO alarms', () => {
  it('recognises a T3 smoke alarm (3.2 kHz) in noise', () => {
    const x = beeps([...t3(0.4), ...t3(4.4)], 7, { noise: 0.03 });
    const m = detectAlarm(x, SR);
    expect(m?.kind).toBe('smoke');
    expect(m!.groups).toBeGreaterThanOrEqual(1);
    expect(Math.abs(m!.freq - 3200)).toBeLessThan(60);
  });

  it('recognises a low-frequency (520 Hz) T3 sounder', () => {
    expect(detectAlarm(beeps(t3(0.5, 520), 4.5), SR)?.kind).toBe('smoke');
  });

  it('recognises a T4 CO alarm', () => {
    const m = detectAlarm(beeps([...t4(0.5), ...t4(5.8)], 7), SR);
    expect(m?.kind).toBe('co');
  });

  it('ignores other beeping: a microwave, a long tone, a timer series, silence', () => {
    expect(detectAlarm(beeps([[0.5, 1.2, 3100]], 3), SR)).toBeNull();
    expect(detectAlarm(beeps([[0.5, 3, 3100]], 4), SR)).toBeNull();
    // Ten equal beeps in a row isn't T3 (no 1.5 s pause after three).
    const series = Array.from({ length: 8 }, (_, k): [number, number, number] => [
      0.3 + k,
      0.5,
      3000,
    ]);
    expect(detectAlarm(beeps(series, 8.5), SR)).toBeNull();
    expect(detectAlarm(beeps([], 3), SR)).toBeNull();
  });
});

/** A two-note "ding-dong" doorbell: decaying 660 Hz then 523 Hz with harmonics. */
function dingDong(
  start: number,
  totalS: number,
  opts: { gain?: number; noise?: number; seed?: number; notes?: number[] } = {},
) {
  const rng = createRng(opts.seed ?? 2);
  const x = new Float64Array(Math.round(totalS * SR));
  (opts.notes ?? [660, 523]).forEach((f, k) => {
    const a = Math.round((start + 0.45 * k) * SR);
    for (let i = 0; a + i < x.length && i < SR; i++) {
      const t = i / SR;
      const v =
        Math.exp(-t / 0.35) *
        (Math.sin(2 * Math.PI * f * t) +
          0.4 * Math.sin(4 * Math.PI * f * t) +
          0.2 * Math.sin(6 * Math.PI * f * t));
      x[a + i] += (opts.gain ?? 0.3) * v;
    }
  });
  for (let i = 0; i < x.length; i++) x[i] += (opts.noise ?? 0.005) * rng.gaussian();
  return x;
}

describe('taught sounds', () => {
  const fp = makeFingerprint(dingDong(0.3, 2.5), SR)!;

  it('fingerprints only the loud part', () => {
    expect(fp.frames.length * fp.hopS).toBeGreaterThan(0.8);
    expect(fp.frames.length * fp.hopS).toBeLessThan(2.3);
    expect(makeFingerprint(new Float64Array(SR), SR)).toBeNull();
  });

  it('learns one ring even if the recording caught two', () => {
    const twice = dingDong(0.3, 6);
    const again = dingDong(3.5, 6, { seed: 3 });
    for (let i = 0; i < twice.length; i++) twice[i] += again[i];
    const f = makeFingerprint(twice, SR)!;
    expect(f.frames.length * f.hopS).toBeLessThan(2.3);
  });

  it('finds the same doorbell later, quieter, in more noise, at another time', () => {
    const live = bandSpectrogram(dingDong(2.1, 6, { gain: 0.08, noise: 0.01, seed: 9 }), SR);
    const m = matchFingerprint(live, fp);
    expect(m.score).toBeGreaterThan(0.8);
    expect(Math.abs(m.atS - 2.1)).toBeLessThan(0.3);
  });

  it('does not match a different chime or speech-like noise', () => {
    const other = bandSpectrogram(dingDong(1, 4, { notes: [880, 1175, 1568], seed: 5 }), SR);
    expect(matchFingerprint(other, fp).score).toBeLessThan(0.6);
    const rng = createRng(7);
    const babble = Float64Array.from(
      { length: 4 * SR },
      (_, i) => 0.2 * Math.sin(i / 900) * rng.gaussian(),
    );
    expect(matchFingerprint(bandSpectrogram(babble, SR), fp).score).toBeLessThan(0.6);
  });
});
