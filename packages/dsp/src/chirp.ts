import { tukey } from './window';

export interface ChirpOptions {
  /** Start frequency, Hz. */
  f0: number;
  /** End frequency, Hz. May be below f0 for a down-chirp. */
  f1: number;
  durationS: number;
  sampleRate: number;
  /** Linear chirps suit matched filtering; log sweeps suit frequency-response measurement. */
  method?: 'linear' | 'log';
  /** Length of each cosine fade at the ends, seconds. Prevents clicks. Default 5 ms. */
  fadeS?: number;
  amplitude?: number;
}

/** Instantaneous phase (radians) of the chirp at time t. */
function phaseAt(o: Required<Omit<ChirpOptions, 'sampleRate' | 'fadeS' | 'amplitude'>>, t: number) {
  const { f0, f1, durationS: T } = o;
  if (o.method === 'log') {
    if (f0 <= 0 || f1 <= 0) throw new Error('Log chirp needs positive frequencies');
    const k = f1 / f0;
    if (Math.abs(k - 1) < 1e-12) return 2 * Math.PI * f0 * t;
    return ((2 * Math.PI * f0 * T) / Math.log(k)) * (Math.pow(k, t / T) - 1);
  }
  return 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * T));
}

/** Instantaneous frequency (Hz) at time t, for mapping sweep time back to frequency. */
export function chirpFrequencyAt(o: ChirpOptions, t: number): number {
  const T = o.durationS;
  if (o.method === 'log') return o.f0 * Math.pow(o.f1 / o.f0, t / T);
  return o.f0 + ((o.f1 - o.f0) * t) / T;
}

export function chirp(o: ChirpOptions): Float32Array {
  const n = Math.round(o.durationS * o.sampleRate);
  if (n <= 0) throw new Error('Chirp duration too short');
  const nyquist = o.sampleRate / 2;
  if (Math.max(o.f0, o.f1) > nyquist) {
    throw new Error(`Chirp frequency above Nyquist (${nyquist} Hz)`);
  }
  const method = o.method ?? 'linear';
  const amp = o.amplitude ?? 1;
  const fadeN = Math.round((o.fadeS ?? 0.005) * o.sampleRate);
  const env = tukey(n, Math.min(1, (2 * fadeN) / n));
  const out = new Float32Array(n);
  const p = { f0: o.f0, f1: o.f1, durationS: o.durationS, method };
  for (let i = 0; i < n; i++) out[i] = amp * env[i] * Math.sin(phaseAt(p, i / o.sampleRate));
  return out;
}

/** A pure tone with fades, for stepped-frequency tests. */
export function tone(
  freq: number,
  durationS: number,
  sampleRate: number,
  amplitude = 1,
  fadeS = 0.005,
) {
  return chirp({ f0: freq, f1: freq, durationS, sampleRate, amplitude, fadeS });
}
