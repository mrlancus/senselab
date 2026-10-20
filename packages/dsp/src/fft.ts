/** Iterative radix-2 complex FFT with cached twiddle tables. */

export const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

const tables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function table(n: number) {
  let t = tables.get(n);
  if (!t) {
    const half = n >> 1;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    t = { cos, sin, rev };
    tables.set(n, t);
  }
  return t;
}

function transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (im.length !== n) throw new Error('re and im must have equal length');
  if (!isPow2(n)) throw new Error(`FFT length must be a power of two, got ${n}`);
  const { cos, sin, rev } = table(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** In-place forward FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  transform(re, im, false);
}

/** In-place inverse FFT (scaled by 1/n). */
export function ifft(re: Float64Array, im: Float64Array): void {
  transform(re, im, true);
}

/** FFT of a real signal, zero-padded to `n` (a power of two ≥ x.length). */
export function realFft(x: ArrayLike<number>, n = nextPow2(x.length)) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const len = Math.min(n, x.length);
  for (let i = 0; i < len; i++) re[i] = x[i];
  fft(re, im);
  return { re, im };
}
