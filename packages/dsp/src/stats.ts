/** Small numeric helpers. All accept any array-like of numbers. */

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : NaN;
}

export function rms(x: ArrayLike<number>, start = 0, end = x.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return end > start ? Math.sqrt(s / (end - start)) : 0;
}

export function median(x: ArrayLike<number>): number {
  if (!x.length) return NaN;
  const s = Array.from(x).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation (unscaled). Multiply by 1.4826 for a Gaussian σ estimate. */
export function mad(x: ArrayLike<number>): number {
  const m = median(x);
  return median(Array.from(x, (v) => Math.abs(v - m)));
}

export function maxAbs(x: ArrayLike<number>, start = 0, end = x.length): number {
  let m = 0;
  for (let i = start; i < end; i++) {
    const a = Math.abs(x[i]);
    if (a > m) m = a;
  }
  return m;
}

export const toDb = (power: number, floor = 1e-20) => 10 * Math.log10(Math.max(power, floor));
export const ampToDb = (amp: number, floor = 1e-10) => 20 * Math.log10(Math.max(amp, floor));
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
