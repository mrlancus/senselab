import { describe, expect, it } from 'vitest';
import { chirp, chirpFrequencyAt, magnitudeSpectrum, argMax, tone } from '../src';
import { SR } from './synth';

/** Dominant frequency of a short slice, via zero-padded FFT. */
function freqAround(x: Float32Array, t: number, sr = SR) {
  const i = Math.round(t * sr);
  const s = magnitudeSpectrum(x.slice(i - 512, i + 512), sr, { zeroPad: 8 });
  return argMax(s.mags) * s.binHz;
}

describe('chirp', () => {
  it('linear chirp sweeps at the requested rate', () => {
    const o = { f0: 17000, f1: 21000, durationS: 0.1, sampleRate: SR };
    const x = chirp(o);
    expect(x.length).toBe(4800);
    expect(freqAround(x, 0.05)).toBeGreaterThan(18800);
    expect(freqAround(x, 0.05)).toBeLessThan(19200);
    expect(chirpFrequencyAt(o, 0.025)).toBe(18000);
  });

  it('log sweep is exponential in time', () => {
    const o = { f0: 100, f1: 10000, durationS: 1, sampleRate: SR, method: 'log' as const };
    const x = chirp(o);
    expect(chirpFrequencyAt(o, 0.5)).toBeCloseTo(1000, 6);
    expect(Math.abs(freqAround(x, 0.5) - 1000)).toBeLessThan(30);
  });

  it('fades in and out to avoid clicks', () => {
    const x = chirp({ f0: 1000, f1: 2000, durationS: 0.05, sampleRate: SR, fadeS: 0.005 });
    expect(Math.abs(x[0])).toBe(0);
    expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-3);
    expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(0.99);
  });

  it('tone is a constant-frequency chirp', () => {
    const x = tone(440, 0.2, SR, 0.5);
    expect(Math.abs(freqAround(x, 0.1) - 440)).toBeLessThan(6);
  });

  it('rejects impossible requests', () => {
    expect(() => chirp({ f0: 1000, f1: 30000, durationS: 0.1, sampleRate: SR })).toThrow(/Nyquist/);
    expect(() => chirp({ f0: 1000, f1: 2000, durationS: 0, sampleRate: SR })).toThrow(/short/);
    expect(() =>
      chirp({ f0: 0, f1: 2000, durationS: 0.1, sampleRate: SR, method: 'log' }),
    ).toThrow();
    expect(chirp({ f0: 500, f1: 500, durationS: 0.01, sampleRate: SR, method: 'log' }).length).toBe(
      480,
    );
  });
});
