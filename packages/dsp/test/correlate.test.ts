import { describe, expect, it } from 'vitest';
import { chirp, crossCorrelate, envelope, findDelay, findPeaks } from '../src';
import { addNoise, fractionalDelay, mixDelayed, SR } from './synth';

const ping = chirp({ f0: 17000, f1: 21000, durationS: 0.01, sampleRate: SR, amplitude: 1 });

describe('cross-correlation', () => {
  it('matches a direct computation', () => {
    const s = [0, 1, 2, 3, 2, 1, 0, 0];
    const t = [1, 2, 1];
    const r = crossCorrelate(s, t);
    const direct = s.map((_, k) => t.reduce((acc, v, n) => acc + v * (s[n + k] ?? 0), 0));
    r.forEach((v, k) => expect(v).toBeCloseTo(direct[k], 9));
    expect(crossCorrelate(s, t, 2)).toHaveLength(3);
  });

  it('finds a known integer delay in noise', () => {
    const delay = 1234;
    const sig = addNoise(mixDelayed(8192, [{ src: ping, delay, gain: 0.2 }]), 0.05, 11);
    const est = findDelay(sig, ping);
    expect(Math.abs(est.lag - delay)).toBeLessThan(0.5);
    expect(est.score).toBeGreaterThan(0.3);
  });

  it('finds a fractional delay to sub-sample accuracy with the envelope', () => {
    const delay = 777.4;
    const sig = fractionalDelay(ping, delay, 4096).map((v) => v * 0.5);
    expect(Math.abs(findDelay(sig, ping, { useEnvelope: true }).lag - delay)).toBeLessThan(0.2);
    // The raw correlation oscillates at the carrier, so its argmax can be off by whole
    // carrier cycles (~2.5 samples at 19 kHz). That's why ranging uses the envelope.
    expect(Math.abs(findDelay(sig, ping).lag - delay)).toBeLessThan(3);
  });

  it('separates a direct path from a weaker echo (sonar geometry)', () => {
    // Direct speaker→mic at 50 samples, echo off a water surface 30 cm away (≈ 84 samples later).
    const echoDelay = 50 + (2 * 0.3 * SR) / 343;
    const sig = addNoise(
      mixDelayed(4096, [
        { src: ping, delay: 50, gain: 1 },
        { src: ping, delay: echoDelay, gain: 0.15 },
      ]),
      0.01,
      5,
    );
    const env = envelope(crossCorrelate(sig, ping));
    const direct = findDelay(sig, ping, { useEnvelope: true });
    expect(Math.abs(direct.lag - 50)).toBeLessThan(1);
    // The echo is the strongest local maximum after the direct one; a plain "max after
    // index N" would land on the direct path's falling edge.
    const echo = findPeaks(env, { start: 55, end: 400 })[0]!;
    expect(Math.abs(echo.position - echoDelay)).toBeLessThan(1.5);
  });

  it('envelope of a modulated tone recovers its amplitude', () => {
    const x = Array.from(
      { length: 2048 },
      (_, i) => 0.7 * Math.sin((2 * Math.PI * 200 * i) / 2048),
    );
    const e = envelope(x);
    expect(e[1024]).toBeCloseTo(0.7, 2);
  });

  it('scores silence as zero', () => {
    expect(findDelay(new Float64Array(1024), ping).score).toBe(0);
  });
});
