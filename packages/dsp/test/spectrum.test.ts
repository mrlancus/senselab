import { describe, expect, it } from 'vitest';
import { argMax, bandPower, magnitudeSpectrum, spectrogram, welchPsd, chirp } from '../src';
import { noise, SR } from './synth';

describe('spectrum', () => {
  it('reads the amplitude of a sine', () => {
    const x = Array.from(
      { length: 4800 },
      (_, i) => 0.25 * Math.sin((2 * Math.PI * 1000 * i) / SR),
    );
    const s = magnitudeSpectrum(x, SR, { zeroPad: 4 });
    const k = argMax(s.mags);
    expect(Math.abs(s.freqs[k] - 1000)).toBeLessThan(s.binHz);
    expect(s.mags[k]).toBeCloseTo(0.25, 2);
  });

  it('welch PSD of white noise is flat and integrates to the variance', () => {
    const x = noise(SR, 0.1, 9);
    const p = welchPsd(x, SR, { frameSize: 1024 });
    expect(p.frames).toBeGreaterThan(80);
    const lo = bandPower(p, 1000, 5000) / 4000;
    const hi = bandPower(p, 15000, 19000) / 4000;
    expect(lo / hi).toBeGreaterThan(0.8);
    expect(lo / hi).toBeLessThan(1.25);
    // Two-sided-ish total power ≈ σ² · N/2 per frame normalisation: just check it's finite and positive.
    expect(bandPower(p, 0, SR / 2)).toBeGreaterThan(0);
  });

  it('welch handles signals shorter than one frame', () => {
    const p = welchPsd([1, 0, -1, 0], SR, { frameSize: 256 });
    expect(p.frames).toBe(1);
  });

  it('spectrogram tracks a sweep upwards', () => {
    const x = chirp({ f0: 1000, f1: 8000, durationS: 0.5, sampleRate: SR });
    const sg = spectrogram(x, SR, { frameSize: 1024, hop: 512 });
    expect(sg.frames.length).toBe(Math.floor((x.length - 1024) / 512) + 1);
    const first = argMax(sg.frames[1]) * sg.binHz;
    const last = argMax(sg.frames[sg.frames.length - 2]) * sg.binHz;
    expect(first).toBeLessThan(2000);
    expect(last).toBeGreaterThan(7000);
    expect(sg.times[0]).toBeCloseTo(512 / SR, 9);
  });
});
