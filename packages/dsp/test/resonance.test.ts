import { describe, expect, it } from 'vitest';
import { estimateResonance } from '../src';
import { addNoise, decayingSine, SR } from './synth';

describe('resonance estimation', () => {
  it.each([180, 523.25, 912.7, 2400])('finds %f Hz within 0.5 Hz', (f) => {
    const x = addNoise(
      decayingSine(f, { tau: 0.06, amp: 0.3, totalS: 0.25, phase: 0.7 }),
      0.003,
      2,
    );
    const r = estimateResonance(x, SR)!;
    expect(Math.abs(r.frequency - f)).toBeLessThan(0.5);
    expect(r.snrDb).toBeGreaterThan(30);
  });

  it('picks the stronger of two modes and lists both', () => {
    const hi = decayingSine(1300, { amp: 0.3 });
    const x = decayingSine(400, { amp: 0.1 }).map((v, i) => v + hi[i]);
    const r = estimateResonance(x, SR)!;
    expect(Math.abs(r.frequency - 1300)).toBeLessThan(1);
    expect(r.peaks.map((p) => Math.round(p.frequency / 10) * 10)).toEqual(
      expect.arrayContaining([400, 1300]),
    );
  });

  it('limits the search band', () => {
    const hi = decayingSine(1300, { amp: 0.3 });
    const x = decayingSine(400, { amp: 0.1 }).map((v, i) => v + hi[i]);
    const r = estimateResonance(x, SR, { fMax: 900 })!;
    expect(Math.abs(r.frequency - 400)).toBeLessThan(1);
  });

  it('heavier damping gives a lower Q', () => {
    const ring = estimateResonance(decayingSine(800, { tau: 0.1 }), SR, { windowS: 0.2 })!;
    const thud = estimateResonance(decayingSine(800, { tau: 0.004 }), SR, { windowS: 0.2 })!;
    expect(ring.q).toBeGreaterThan(thud.q * 3);
    expect(thud.bandwidthHz).toBeGreaterThan(ring.bandwidthHz);
  });

  it('returns null for too-short input or no peak', () => {
    expect(estimateResonance(new Float64Array(50), SR)).toBeNull();
    expect(estimateResonance(new Float64Array(SR / 4), SR)).toBeNull();
    expect(estimateResonance(decayingSine(500), SR, { fMin: 1000, fMax: 1001 })).toBeNull();
  });
});
