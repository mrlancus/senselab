import { linearFit } from './fit';
import { detectOnsets } from './onset';
import { median, toDb } from './stats';

/**
 * Reverberation time from an impulse (a clap, a balloon pop).
 *
 * After an impulse, the sound energy in a room decays roughly exponentially. RT60 is the
 * time it takes to fall by 60 dB. Rooms rarely give 60 dB above the noise, so we measure
 * the slope over a smaller range and extrapolate (ISO 3382):
 *
 * - EDT: 0 to −10 dB (early decay time, close to how reverberant a room sounds)
 * - T20: −5 to −25 dB, × 3
 * - T30: −5 to −35 dB, × 2
 *
 * The decay curve is Schroeder's backward integral of the squared impulse response,
 * which averages out the random fluctuations of a single decay. Background noise is
 * subtracted, and the integral stops where the decay meets the noise (after Lundeby
 * et al. 1995), with the energy beyond that point added back from the fitted slope.
 */

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook band-pass (0 dB peak gain) at `f0` Hz with quality `q`. */
export function bandpassBiquad(f0: number, q: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w)) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function biquadFilter(x: ArrayLike<number>, c: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Octave-band centres analysed (Hz), limited to those below 0.4·fs. */
export const OCTAVE_BANDS = [250, 500, 1000, 2000, 4000, 8000];

/**
 * Octave band-pass: two cascaded band-pass biquads with Q = √2 (the octave-wide value).
 * Its own ringing (≈ Q/(πf), 1.8 ms at 250 Hz) is far shorter than any room decay.
 */
export function octaveBand(x: ArrayLike<number>, fc: number, sampleRate: number): Float64Array {
  const c = bandpassBiquad(fc, Math.SQRT2, sampleRate);
  return biquadFilter(biquadFilter(x, c), c);
}

export interface DecayFit {
  /** Reverberation time extrapolated to 60 dB, seconds. */
  seconds: number;
  /** Fit quality, r² of the line through the decay curve over the range. */
  r2: number;
}

export interface DecayResult {
  /** Decay curve (dB, 0 at the start), one value per `curveStepS`. */
  curveDb: Float64Array;
  curveStepS: number;
  edt: DecayFit | null;
  t20: DecayFit | null;
  t30: DecayFit | null;
  /** Peak energy over the noise floor, dB. Needs ≥ 35 dB for T20, ≥ 45 dB for T30. */
  dynamicRangeDb: number;
  /** Where the decay met the noise and integration stopped, s after the impulse. */
  truncationS: number;
  noiseDb: number;
}

/**
 * Decay analysis of `x`, which should start at the impulse. `noisePower` is the mean
 * square of the background (same filtering); if omitted, the last 10% of `x` is used.
 */
export function analyzeDecay(
  x: ArrayLike<number>,
  sampleRate: number,
  noisePower?: number,
): DecayResult {
  const n = x.length;
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) e[i] = x[i] * x[i];
  let noise = noisePower;
  if (noise == null) {
    let s = 0;
    const from = Math.floor(n * 0.9);
    for (let i = from; i < n; i++) s += e[i];
    noise = s / Math.max(1, n - from);
  }
  noise = Math.max(noise, 1e-20);

  // 10 ms blocks of mean energy, for finding where the decay meets the noise.
  const block = Math.max(1, Math.round(0.01 * sampleRate));
  const blocks: number[] = [];
  for (let i = 0; i + block <= n; i += block) {
    let s = 0;
    for (let j = i; j < i + block; j++) s += e[j];
    blocks.push(s / block);
  }
  const blockDb = blocks.map((b) => toDb(b));
  let peakBlock = 0;
  for (let i = 1; i < blocks.length; i++) if (blocks[i] > blocks[peakBlock]) peakBlock = i;
  const noiseDb = toDb(noise);
  const dynamicRangeDb = blockDb[peakBlock] - noiseDb;

  // Truncation point: fit the blocks from the peak down to noise + 10 dB, and find where
  // that line reaches the noise level.
  let lastAbove = peakBlock;
  while (lastAbove + 1 < blocks.length && blockDb[lastAbove + 1] > noiseDb + 10) lastAbove++;
  let truncBlock = blocks.length;
  let slopeDbPerS = -60; // fallback only matters for the tail correction
  if (lastAbove - peakBlock >= 2) {
    const ts = [];
    const ds = [];
    for (let i = peakBlock; i <= lastAbove; i++) {
      ts.push((i + 0.5) * (block / sampleRate));
      ds.push(blockDb[i]);
    }
    const f = linearFit(ts, ds);
    if (f.slope < 0) {
      slopeDbPerS = f.slope;
      const tc = (noiseDb - f.intercept) / f.slope;
      truncBlock = Math.min(
        blocks.length,
        Math.max(lastAbove + 1, Math.round(tc / (block / sampleRate))),
      );
    }
  }
  const end = Math.min(n, truncBlock * block);

  // Backward integral of (energy − noise) up to the truncation point, plus the tail
  // beyond it: an exponential with the fitted slope starting at the noise level,
  // ∫ N·exp(−t/τ) dt = N·τ with τ = 10·log10(e) / |slope|.
  const tau = (10 * Math.LOG10E) / Math.abs(slopeDbPerS);
  const tail = noise * tau * sampleRate;
  const edc = new Float64Array(end);
  let acc = tail;
  for (let i = end - 1; i >= 0; i--) {
    acc += Math.max(0, e[i] - noise);
    edc[i] = acc;
  }
  const total = edc[0] || 1;

  const stepS = 0.005;
  const step = Math.max(1, Math.round(stepS * sampleRate));
  const curveDb = Float64Array.from({ length: Math.ceil(end / step) }, (_, k) =>
    toDb(edc[k * step] / total),
  );
  // RT60 = −60 dB / slope: the same as "20 dB decay time × 3" for T20, etc.
  const fitRange = (hiDb: number, loDb: number): DecayFit | null => {
    if (dynamicRangeDb < -loDb + 10) return null;
    const ts: number[] = [];
    const ds: number[] = [];
    for (let k = 0; k < curveDb.length; k++) {
      if (curveDb[k] <= hiDb && curveDb[k] >= loDb) {
        ts.push(k * stepS);
        ds.push(curveDb[k]);
      }
      if (curveDb[k] < loDb) break;
    }
    if (ts.length < 4 || curveDb[curveDb.length - 1] > loDb) return null;
    const f = linearFit(ts, ds);
    if (!(f.slope < 0)) return null;
    return { seconds: -60 / f.slope, r2: f.r2 };
  };
  return {
    curveDb,
    curveStepS: stepS,
    edt: fitRange(0, -10),
    t20: fitRange(-5, -25),
    t30: fitRange(-5, -35),
    dynamicRangeDb,
    truncationS: end / sampleRate,
    noiseDb,
  };
}

export interface RoomBand extends DecayResult {
  fc: number;
  /**
   * Expected relative scatter (1σ) of a single-impulse estimate: ≈ 1/√(B·T) for bandwidth
   * B = 0.71·fc (one octave). The decay of one impulse is itself random; narrow, low bands
   * and short decays fluctuate most (≈ 10% at 250 Hz for T = 0.6 s). Several claps average
   * it down by √n.
   */
  scatter: number | null;
}

export interface RoomAnalysis {
  /** Impulse onset in the recording, seconds; null if no impulse was found. */
  onsetS: number | null;
  broadband: DecayResult | null;
  bands: RoomBand[];
  /** Best single number: median T20 (else T30, else EDT) of the 500 Hz–2 kHz bands. */
  rt60: number | null;
}

/**
 * Finds the strongest impulse in a recording and analyses the decay after it, broadband
 * and per octave band. Background noise comes from before the impulse when there's at
 * least 0.2 s of it, else from the end of the recording.
 */
export function analyzeRoom(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: { maxDecayS?: number } = {},
): RoomAnalysis {
  const onsets = detectOnsets(x, sampleRate, { thresholdDb: 20 });
  if (!onsets.length) return { onsetS: null, broadband: null, bands: [], rt60: null };
  const best = onsets.reduce((a, b) => (b.strengthDb > a.strengthDb ? b : a));
  // Back up slightly so the filters' rise is included.
  const start = Math.max(0, best.sample - Math.round(0.002 * sampleRate));
  const stop = Math.min(x.length, start + Math.round((opts.maxDecayS ?? 4) * sampleRate));
  const preLen = start - Math.round(0.02 * sampleRate);

  const analyse = (y: ArrayLike<number>) => {
    let noise: number | undefined;
    if (preLen >= 0.2 * sampleRate) {
      let s = 0;
      for (let i = 0; i < preLen; i++) s += y[i] * y[i];
      noise = s / preLen;
    }
    return analyzeDecay(Array.prototype.slice.call(y, start, stop) as number[], sampleRate, noise);
  };

  const broadband = analyse(x);
  const pick = (b: DecayResult) => b.t20?.seconds ?? b.t30?.seconds ?? b.edt?.seconds ?? null;
  const bands: RoomBand[] = OCTAVE_BANDS.filter((fc) => fc < 0.4 * sampleRate).map((fc) => {
    const d = analyse(octaveBand(x, fc, sampleRate));
    const t = pick(d);
    return { fc, ...d, scatter: t ? 1 / Math.sqrt(0.71 * fc * t) : null };
  });
  const mids = bands
    .filter((b) => b.fc >= 500 && b.fc <= 2000)
    .map(pick)
    .filter((v): v is number => v != null);
  const rt60 = mids.length ? median(mids) : pick(broadband);
  return { onsetS: start / sampleRate, broadband, bands, rt60 };
}
