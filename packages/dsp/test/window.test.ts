import { describe, expect, it } from 'vitest';
import { applyWindow, coherentGain, makeWindow, tukey } from '../src';

describe('windows', () => {
  it('have the textbook shapes', () => {
    const h = makeWindow('hann', 5);
    expect(Array.from(h)).toEqual([0, 0.5, 1, 0.5, 0].map((v) => expect.closeTo(v, 12)));
    expect(makeWindow('hamming', 3)[0]).toBeCloseTo(0.08, 12);
    expect(makeWindow('blackman-harris', 3)[1]).toBeCloseTo(1, 4);
    expect(Array.from(makeWindow('rect', 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(makeWindow('hann', 1))).toEqual([1]);
    expect(coherentGain(makeWindow('hann', 4097))).toBeCloseTo(0.5, 3);
  });

  it('tukey is flat in the middle and tapers at the ends', () => {
    const w = tukey(100, 0.2);
    expect(w[0]).toBe(0);
    expect(w[50]).toBe(1);
    expect(w[99]).toBe(0);
    expect(w[5]).toBeGreaterThan(0);
    expect(w[5]).toBeLessThan(1);
    expect(Array.from(tukey(4, 0))).toEqual([1, 1, 1, 1]);
  });

  it('applyWindow zero-fills outside the signal', () => {
    expect(Array.from(applyWindow([1, 2, 3], [1, 1, 1, 1], 1))).toEqual([2, 3, 0, 0]);
    expect(Array.from(applyWindow([1, 2, 3], [1, 1], -1))).toEqual([0, 1]);
  });
});
