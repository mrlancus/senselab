import { fft, ifft, nextPow2 } from './fft';
import { argMax, parabolicPeak } from './peaks';

/**
 * Cross-correlation r[k] = Σₙ signal[n + k] · template[n] for lags k = 0 … maxLag,
 * computed via FFT. This is a matched filter: r peaks at the lag where the template
 * appears in the signal.
 */
export function crossCorrelate(
  signal: ArrayLike<number>,
  template: ArrayLike<number>,
  maxLag = signal.length - 1,
): Float64Array {
  const n = nextPow2(signal.length + template.length);
  const sr = new Float64Array(n);
  const si = new Float64Array(n);
  const tr = new Float64Array(n);
  const ti = new Float64Array(n);
  for (let i = 0; i < signal.length; i++) sr[i] = signal[i];
  for (let i = 0; i < template.length; i++) tr[i] = template[i];
  fft(sr, si);
  fft(tr, ti);
  // S · conj(T)
  for (let k = 0; k < n; k++) {
    const r = sr[k] * tr[k] + si[k] * ti[k];
    const i = si[k] * tr[k] - sr[k] * ti[k];
    sr[k] = r;
    si[k] = i;
  }
  ifft(sr, si);
  const lags = Math.min(maxLag + 1, signal.length);
  return sr.slice(0, lags);
}

/** Analytic signal x + i·H{x} (H = Hilbert transform), via FFT. */
export function analytic(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = nextPow2(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft(re, im);
  // Keep DC and Nyquist, double positive frequencies, zero negative ones.
  for (let k = 1; k < n / 2; k++) {
    re[k] *= 2;
    im[k] *= 2;
  }
  for (let k = n / 2 + 1; k < n; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  ifft(re, im);
  return { re: re.slice(0, x.length), im: im.slice(0, x.length) };
}

/**
 * Magnitude of the analytic signal (Hilbert envelope). Turns an oscillating correlation
 * into a smooth bump whose peak is robust to the carrier phase.
 */
export function envelope(x: ArrayLike<number>): Float64Array {
  const { re, im } = analytic(x);
  return re.map((v, i) => Math.hypot(v, im[i]));
}

export interface DelayEstimate {
  /** Sub-sample lag at which the template best matches the signal. */
  lag: number;
  /** Peak correlation normalised to [0, 1] by template and local signal energy. */
  score: number;
}

/** Finds where `template` occurs in `signal` (lag in samples from signal start). */
export function findDelay(
  signal: ArrayLike<number>,
  template: ArrayLike<number>,
  opts: { maxLag?: number; useEnvelope?: boolean } = {},
): DelayEstimate {
  const r = crossCorrelate(signal, template, opts.maxLag);
  const y = opts.useEnvelope ? envelope(r) : r;
  const i = argMax(y);
  const offset = i > 0 && i < y.length - 1 ? parabolicPeak(y[i - 1], y[i], y[i + 1]).offset : 0;

  let tEnergy = 0;
  for (let k = 0; k < template.length; k++) tEnergy += template[k] * template[k];
  let sEnergy = 0;
  for (let k = i; k < Math.min(signal.length, i + template.length); k++) {
    sEnergy += signal[k] * signal[k];
  }
  const denom = Math.sqrt(tEnergy * sEnergy);
  // With the envelope, score its peak: the raw correlation at that index can sit on a
  // carrier zero crossing (a 19 kHz chirp flips sign every ~1.3 samples at 48 kHz).
  const peak = opts.useEnvelope ? y[i] : Math.abs(r[i]);
  return { lag: i + offset, score: denom > 0 ? Math.min(1, peak / denom) : 0 };
}
