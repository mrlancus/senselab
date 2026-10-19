import { nextPow2, realFft } from './fft';
import { toDb } from './stats';
import { applyWindow, coherentGain, makeWindow, type WindowName } from './window';

export interface Spectrum {
  /** Frequency of each bin, Hz. */
  freqs: Float64Array;
  /** Single-sided amplitude spectrum (a full-scale sine of amplitude A reads ≈ A). */
  mags: Float64Array;
  binHz: number;
}

export interface SpectrumOptions {
  window?: WindowName;
  /** FFT size (power of two). Defaults to next pow2 ≥ zeroPad × length. */
  fftSize?: number;
  zeroPad?: number;
}

export function magnitudeSpectrum(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: SpectrumOptions = {},
): Spectrum {
  const w = makeWindow(opts.window ?? 'hann', x.length);
  const frame = applyWindow(x, w);
  const n = opts.fftSize ?? nextPow2(Math.max(2, x.length * (opts.zeroPad ?? 1)));
  const { re, im } = realFft(frame, n);
  const bins = n / 2 + 1;
  const mags = new Float64Array(bins);
  const scale = 2 / (x.length * coherentGain(w));
  for (let k = 0; k < bins; k++) mags[k] = Math.hypot(re[k], im[k]) * scale;
  mags[0] /= 2;
  const binHz = sampleRate / n;
  const freqs = new Float64Array(bins);
  for (let k = 0; k < bins; k++) freqs[k] = k * binHz;
  return { freqs, mags, binHz };
}

export interface Psd {
  freqs: Float64Array;
  /** Power per bin (arbitrary but consistent units; compare PSDs computed with equal settings). */
  psd: Float64Array;
  binHz: number;
  frames: number;
}

/** Welch power spectral density: averaged periodograms of overlapping windowed frames. */
export function welchPsd(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: { frameSize?: number; overlap?: number; window?: WindowName } = {},
): Psd {
  const n = opts.frameSize ?? 4096;
  const hop = Math.max(1, Math.round(n * (1 - (opts.overlap ?? 0.5))));
  const w = makeWindow(opts.window ?? 'hann', n);
  let wPow = 0;
  for (let i = 0; i < n; i++) wPow += w[i] * w[i];
  const bins = n / 2 + 1;
  const psd = new Float64Array(bins);
  let frames = 0;
  for (let start = 0; start + n <= x.length || frames === 0; start += hop) {
    const { re, im } = realFft(applyWindow(x, w, start), n);
    for (let k = 0; k < bins; k++) psd[k] += (re[k] * re[k] + im[k] * im[k]) / wPow;
    frames++;
    if (start + n >= x.length) break;
  }
  for (let k = 0; k < bins; k++) psd[k] /= frames;
  const binHz = sampleRate / n;
  return { freqs: Float64Array.from({ length: bins }, (_, k) => k * binHz), psd, binHz, frames };
}

export interface Spectrogram {
  /** frames[t][k]: power in dB of frame t, bin k. */
  frames: Float32Array[];
  /** Centre time of each frame, seconds. */
  times: Float64Array;
  binHz: number;
  frameSize: number;
  hop: number;
}

export function spectrogram(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: { frameSize?: number; hop?: number; window?: WindowName } = {},
): Spectrogram {
  const n = opts.frameSize ?? 1024;
  const hop = opts.hop ?? n >> 2;
  const w = makeWindow(opts.window ?? 'hann', n);
  const norm = (n * coherentGain(w)) / 2;
  const bins = n / 2 + 1;
  const frames: Float32Array[] = [];
  const times: number[] = [];
  for (let start = 0; start + n <= x.length; start += hop) {
    const { re, im } = realFft(applyWindow(x, w, start), n);
    const f = new Float32Array(bins);
    for (let k = 0; k < bins; k++) f[k] = toDb((re[k] * re[k] + im[k] * im[k]) / (norm * norm));
    frames.push(f);
    times.push((start + n / 2) / sampleRate);
  }
  return { frames, times: Float64Array.from(times), binHz: sampleRate / n, frameSize: n, hop };
}

/** Sum of PSD over [fLo, fHi), linear power. */
export function bandPower(p: Psd, fLo: number, fHi: number): number {
  let s = 0;
  for (let k = 0; k < p.psd.length; k++) {
    if (p.freqs[k] >= fLo && p.freqs[k] < fHi) s += p.psd[k];
  }
  return s;
}
