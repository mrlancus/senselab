import { describe, expect, it } from 'vitest';
import { analyzeSweep, makeSweep, pickChirpBand, sweepOptions, type BandResult } from '../src';
import { addNoise, lowpass, mixDelayed, noise, SR } from './synth';

function simulate(opts: {
  cutoffHz?: number;
  gain?: number;
  latency?: number;
  noiseSigma?: number;
}) {
  const o = sweepOptions(SR, 1.5);
  const emitted = makeSweep(SR, 1.5);
  const path = opts.cutoffHz ? lowpass(lowpass(emitted, opts.cutoffHz), opts.cutoffHz) : emitted;
  const latency = opts.latency ?? 2400;
  const total = emitted.length + latency + 4800;
  const recorded = addNoise(
    mixDelayed(total, [{ src: path, delay: latency, gain: opts.gain ?? 0.3 }]),
    opts.noiseSigma ?? 0.001,
    3,
  );
  return { sweep: o, emitted, recorded, noise: noise(SR / 2, opts.noiseSigma ?? 0.001, 8) };
}

describe('sweep analysis', () => {
  it('flat device: measures latency and recommends a near-ultrasonic band', () => {
    const a = analyzeSweep(simulate({ latency: 2400 }));
    expect(a.heard).toBe(true);
    expect(a.latencyS).toBeCloseTo(0.05, 3);
    expect(a.usableMaxHz).toBeGreaterThanOrEqual(22000);
    expect(a.recommended?.kind).toBe('ultrasonic');
    expect(a.recommended!.f1 - a.recommended!.f0).toBeGreaterThanOrEqual(4000);
    for (const b of a.bands) expect(b.responseDb).toBeGreaterThan(-6);
  });

  it('rolled-off device: falls back to an audible band', () => {
    const a = analyzeSweep(simulate({ cutoffHz: 1500, gain: 0.3, noiseSigma: 0.003 }));
    const hi = a.bands.find((b) => b.fLo === 20000)!;
    const lo = a.bands.find((b) => b.fLo === 1000)!;
    expect(hi.responseDb).toBeLessThan(lo.responseDb - 20);
    expect(a.recommended?.kind).toBe('audible');
    expect(a.recommended!.f0).toBeGreaterThanOrEqual(2000);
  });

  it('silent speaker: not heard, no recommendation', () => {
    const a = analyzeSweep(simulate({ gain: 0 }));
    expect(a.heard).toBe(false);
    expect(a.recommended).toBeNull();
  });

  it('pickChirpBand requires contiguous, wide, high-SNR runs', () => {
    const band = (fLo: number, fHi: number, snrDb: number): BandResult => ({
      fLo,
      fHi,
      snrDb,
      responseDb: 0,
    });
    expect(pickChirpBand([band(17000, 18000, 30), band(18000, 19000, 30)])).toEqual({
      f0: 17000,
      f1: 19000,
      kind: 'ultrasonic',
    });
    expect(
      pickChirpBand([band(17000, 18000, 30), band(18000, 19000, 5), band(19000, 20000, 30)]),
    ).toBeNull();
    expect(
      pickChirpBand([band(2000, 4000, 30), band(4000, 6000, 30), band(17000, 18000, 30)]),
    ).toEqual({
      f0: 2000,
      f1: 6000,
      kind: 'audible',
    });
    // A good run only above 8 kHz must not be clipped to a zero-width band.
    expect(pickChirpBand([band(8000, 10000, 30), band(10000, 12000, 30)])).toEqual({
      f0: 8000,
      f1: 12000,
      kind: 'audible',
    });
    // 1–3 kHz clips to 2–3 kHz (too narrow), so the unclipped run is used.
    expect(pickChirpBand([band(1000, 2000, 30), band(2000, 3000, 30)])).toEqual({
      f0: 1000,
      f1: 3000,
      kind: 'audible',
    });
  });
});
