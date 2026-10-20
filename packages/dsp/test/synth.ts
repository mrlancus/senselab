import { createRng, fft, ifft, nextPow2 } from '../src';

export const SR = 48000;

/** A·e^(−t/τ)·sin(2πft + φ), starting at `startS` in a buffer of `totalS` seconds. */
export function decayingSine(
  f: number,
  opts: {
    tau?: number;
    amp?: number;
    startS?: number;
    totalS?: number;
    phase?: number;
    sr?: number;
  } = {},
) {
  const sr = opts.sr ?? SR;
  const n = Math.round((opts.totalS ?? 0.3) * sr);
  const start = Math.round((opts.startS ?? 0) * sr);
  const out = new Float64Array(n);
  for (let i = start; i < n; i++) {
    const t = (i - start) / sr;
    out[i] =
      (opts.amp ?? 0.5) *
      Math.exp(-t / (opts.tau ?? 0.05)) *
      Math.sin(2 * Math.PI * f * t + (opts.phase ?? 0));
  }
  return out;
}

export function addNoise(x: ArrayLike<number>, sigma: number, seed = 1) {
  const rng = createRng(seed);
  return Float64Array.from(x, (v) => v + sigma * rng.gaussian());
}

export function noise(n: number, sigma: number, seed = 1) {
  return addNoise(new Float64Array(n), sigma, seed);
}

/** out = Σ gainᵢ · srcᵢ delayed by dᵢ samples (integer or fractional via linear interp). */
export function mixDelayed(
  length: number,
  parts: { src: ArrayLike<number>; delay: number; gain?: number }[],
) {
  const out = new Float64Array(length);
  for (const { src, delay, gain = 1 } of parts) {
    const d0 = Math.floor(delay);
    const frac = delay - d0;
    for (let i = 0; i < src.length; i++) {
      const a = src[i] * gain;
      if (i + d0 < length) out[i + d0] += a * (1 - frac);
      if (frac && i + d0 + 1 < length) out[i + d0 + 1] += a * frac;
    }
  }
  return out;
}

/** One-pole low-pass, to mimic a speaker/mic that rolls off. */
export function lowpass(x: ArrayLike<number>, cutoffHz: number, sr = SR) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sr);
  const out = new Float64Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) out[i] = y = (1 - a) * x[i] + a * y;
  return out;
}

/** Exact band-limited fractional delay via FFT phase shift (circular; pad `length` generously). */
export function fractionalDelay(x: ArrayLike<number>, delay: number, length: number) {
  const n = nextPow2(length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const f = k <= n / 2 ? k : k - n;
    const a = (-2 * Math.PI * f * delay) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = re[k] * c - im[k] * s;
    im[k] = re[k] * s + im[k] * c;
    re[k] = r;
  }
  // Keep the Nyquist bin real so the output stays real.
  ifft(re, im);
  return re.slice(0, length);
}
