import { describe, expect, it } from 'vitest';
import { detectOnsets } from '../src';
import { addNoise, decayingSine, mixDelayed, noise, SR } from './synth';

describe('onset detection', () => {
  const tap = decayingSine(650, { tau: 0.04, amp: 0.4, totalS: 0.3 });

  it('finds taps at known times to within 1 ms, ignoring their ringing tails', () => {
    const times = [0.25, 0.8, 1.31, 1.9];
    const x = addNoise(
      mixDelayed(
        Math.round(2.4 * SR),
        times.map((t) => ({ src: tap, delay: Math.round(t * SR) })),
      ),
      0.003,
      21,
    );
    const onsets = detectOnsets(x, SR);
    expect(onsets).toHaveLength(times.length);
    onsets.forEach((o, i) => {
      expect(Math.abs(o.time - times[i])).toBeLessThan(0.001);
      expect(o.strengthDb).toBeGreaterThan(30);
    });
  });

  it('reports nothing in pure noise or silence', () => {
    expect(detectOnsets(noise(SR, 0.01, 4), SR)).toEqual([]);
    expect(detectOnsets(new Float64Array(SR), SR)).toEqual([]);
    expect(detectOnsets(new Float64Array(10), SR)).toEqual([]);
  });

  it('respects the minimum gap', () => {
    const x = mixDelayed(SR, [
      { src: tap, delay: 4800 },
      { src: tap, delay: 4800 + 2400, gain: 3 },
    ]);
    expect(detectOnsets(x, SR, { minGapS: 0.12 })).toHaveLength(1);
    expect(detectOnsets(x, SR, { minGapS: 0.02 })).toHaveLength(2);
  });
});
