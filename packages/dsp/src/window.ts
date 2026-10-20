/** Window functions (symmetric). Multiply a frame by one before an FFT to reduce leakage. */

export type WindowName = 'rect' | 'hann' | 'hamming' | 'blackman-harris';

export function makeWindow(name: WindowName, n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  const d = n - 1;
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / d;
    switch (name) {
      case 'rect':
        w[i] = 1;
        break;
      case 'hann':
        w[i] = 0.5 - 0.5 * Math.cos(x);
        break;
      case 'hamming':
        w[i] = 0.54 - 0.46 * Math.cos(x);
        break;
      case 'blackman-harris':
        w[i] =
          0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
        break;
    }
  }
  return w;
}

/**
 * Tukey (tapered cosine) window: flat in the middle, Hann-shaped ramps covering `alpha`
 * of the length in total. Used to fade chirps in and out so the speaker doesn't click.
 */
export function tukey(n: number, alpha: number): Float64Array {
  const w = new Float64Array(n).fill(1);
  if (alpha <= 0 || n < 2) return w;
  const ramp = Math.max(1, Math.floor((alpha * (n - 1)) / 2));
  for (let i = 0; i < ramp; i++) {
    const v = 0.5 * (1 - Math.cos((Math.PI * i) / ramp));
    w[i] = v;
    w[n - 1 - i] = v;
  }
  return w;
}

/** Returns a new Float64Array: x[offset .. offset+w.length) · w (zero beyond x). */
export function applyWindow(x: ArrayLike<number>, w: ArrayLike<number>, offset = 0): Float64Array {
  const out = new Float64Array(w.length);
  for (let i = 0; i < w.length; i++) {
    const j = offset + i;
    out[i] = j >= 0 && j < x.length ? x[j] * w[i] : 0;
  }
  return out;
}

/** Coherent gain (mean of the window), used to convert FFT magnitudes to amplitudes. */
export function coherentGain(w: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s / w.length;
}
