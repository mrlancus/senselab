import { describe, expect, it } from 'vitest';
import { createRng, fft, ifft, isPow2, nextPow2, realFft } from '../src';

function naiveDft(x: number[]) {
  const n = x.length;
  return x.map((_, k) => {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      re += x[t] * Math.cos((-2 * Math.PI * k * t) / n);
      im += x[t] * Math.sin((-2 * Math.PI * k * t) / n);
    }
    return [re, im];
  });
}

describe('fft', () => {
  it('matches a naive DFT', () => {
    const rng = createRng(7);
    const x = Array.from({ length: 64 }, () => rng.next() - 0.5);
    const { re, im } = realFft(x);
    naiveDft(x).forEach(([r, i], k) => {
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(i, 9);
    });
  });

  it('round-trips through ifft', () => {
    const rng = createRng(3);
    const re = Float64Array.from({ length: 1024 }, () => rng.gaussian());
    const im = Float64Array.from({ length: 1024 }, () => rng.gaussian());
    const r0 = re.slice();
    const i0 = im.slice();
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < re.length; i++) {
      expect(re[i]).toBeCloseTo(r0[i], 10);
      expect(im[i]).toBeCloseTo(i0[i], 10);
    }
  });

  it('puts a bin-centred sine in one bin', () => {
    const n = 256;
    const x = Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * 10 * t) / n));
    const { re, im } = realFft(x);
    expect(Math.hypot(re[10], im[10])).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[11], im[11])).toBeLessThan(1e-9);
  });

  it('validates sizes', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(/power of two/);
    expect(() => fft(new Float64Array(8), new Float64Array(4))).toThrow(/equal length/);
    expect(nextPow2(1000)).toBe(1024);
    expect(nextPow2(1024)).toBe(1024);
    expect(isPow2(48)).toBe(false);
  });
});
