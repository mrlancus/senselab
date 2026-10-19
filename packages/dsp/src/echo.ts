import { chirp } from './chirp';
import { analytic, crossCorrelate, envelope } from './correlate';
import { fft, ifft, nextPow2 } from './fft';
import { parabolicPeak } from './peaks';
import { ampToDb, clamp, median } from './stats';
import { makeWindow } from './window';

/**
 * Echo ranging: play a train of short chirps, matched-filter the recording, and measure
 * the time between the direct speaker→mic path and the first strong reflection. Distance
 * is half the extra path: d = Δt·c/2.
 *
 * - The direct path is time zero, so speaker and mic latency cancel out.
 * - The chirps repeat at an exact sample period, so the matched-filter output can be
 *   averaged coherently over the repeats (SNR grows ∝ N).
 * - The matched filter is Hann-weighted (a "mismatched" filter): range sidelobes drop from
 *   about −15 dB to below −30 dB, for a ~1.6× wider main lobe.
 * - The direct path is then subtracted, aligned to a fraction of a sample: a model of a
 *   single direct path by default, or better, a "free air" reference (the same
 *   measurement with nothing within reach), which also removes the direct path's ringing
 *   and the phone's own body reflections that otherwise hide echoes closer than a few cm.
 */

/** Speed of sound in dry air, m/s: c = 331.3·√(1 + T/273.15). 343.2 m/s at 20 °C. */
export function speedOfSound(tempC = 20): number {
  return 331.3 * Math.sqrt(1 + tempC / 273.15);
}

/** Inverse of {@link speedOfSound}: air temperature (°C) for a measured speed. */
export function temperatureForSpeed(c: number): number {
  return ((c / 331.3) ** 2 - 1) * 273.15;
}

export interface EchoConfig {
  sampleRate: number;
  f0: number;
  f1: number;
  /** Chirp length. Default 8 ms. */
  chirpS?: number;
  /** Time between chirps. Must exceed the longest echo of interest plus the room's tail. Default 100 ms. */
  periodS?: number;
  repeats?: number;
  amplitude?: number;
}

export interface EchoTrain {
  chirp: Float32Array;
  /** Matched-filter template: the chirp with a Hann weighting, for low range sidelobes. */
  template: Float32Array;
  train: Float32Array;
  /** Samples between chirp starts. */
  period: number;
  repeats: number;
  sampleRate: number;
  f0: number;
  f1: number;
}

export function makeEchoTrain(cfg: EchoConfig): EchoTrain {
  const sr = cfg.sampleRate;
  const durationS = cfg.chirpS ?? 0.008;
  // Long cosine fades (a Tukey 0.5 envelope): no click, and lower range sidelobes.
  const c = chirp({
    f0: cfg.f0,
    f1: cfg.f1,
    durationS,
    sampleRate: sr,
    method: 'linear',
    fadeS: durationS / 4,
    amplitude: cfg.amplitude ?? 0.8,
  });
  const period = Math.round((cfg.periodS ?? 0.1) * sr);
  if (period <= c.length) throw new Error('Chirp period must be longer than the chirp');
  const repeats = cfg.repeats ?? 12;
  const train = new Float32Array(period * repeats);
  for (let i = 0; i < repeats; i++) train.set(c, i * period);
  const w = makeWindow('hann', c.length);
  const template = Float32Array.from(c, (v, i) => v * w[i]);
  return { chirp: c, template, train, period, repeats, sampleRate: sr, f0: cfg.f0, f1: cfg.f1 };
}

/** Matched-filter main-lobe width in samples (≈ 1.6·fs / bandwidth with the Hann weighting). */
export const lobeSamples = (t: Pick<EchoTrain, 'sampleRate' | 'f0' | 'f1'>) =>
  (1.6 * t.sampleRate) / Math.abs(t.f1 - t.f0);

export interface EchoResponse {
  /** Coherent average of the matched-filter output; the direct path sits near `pre`. */
  corr: Float64Array;
  /** The same window for each repeat, for repeat-to-repeat spread. */
  perRepeat: Float64Array[];
  /** Samples kept before the direct path. */
  pre: number;
  /** Recording index of the first repeat's direct path (integer). */
  directAbs: number;
  sampleRate: number;
}

export interface EchoResponseOptions {
  /** Recording index where playback was scheduled. The direct path is searched after it. */
  emitIndex?: number;
  /** Longest one-way distance kept in the window, cm. Default 150. */
  maxCm?: number;
  /** How far after `emitIndex` to look for the first direct path. Default 0.6 s. */
  searchS?: number;
}

/**
 * Matched-filters a recording of an {@link EchoTrain} and averages the repeats. The first
 * repeat's direct path is the earliest envelope peak at ≥ 50% of the strongest one.
 */
export function echoResponse(
  recorded: ArrayLike<number>,
  train: EchoTrain,
  opts: EchoResponseOptions = {},
): EchoResponse {
  const sr = train.sampleRate;
  const r = crossCorrelate(recorded, train.template);
  const env = envelope(r);
  const from = clamp(Math.round(opts.emitIndex ?? 0), 0, env.length - 1);
  const to = Math.min(env.length, from + Math.round((opts.searchS ?? 0.6) * sr));
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, env[i]);
  let directAbs = from;
  for (let i = from + 1; i < to - 1; i++) {
    if (env[i] >= 0.5 * max && env[i] >= env[i - 1] && env[i] >= env[i + 1]) {
      directAbs = i;
      break;
    }
  }
  const pre = Math.round(0.002 * sr);
  // Sized for a slow (cold) 330 m/s, so the window length doesn't depend on temperature
  // and a reference recorded on another day still lines up.
  const len =
    pre + Math.ceil((2 * ((opts.maxCm ?? 150) / 100) * sr) / 330) + Math.round(0.002 * sr);
  const perRepeat: Float64Array[] = [];
  for (let k = 0; k < train.repeats; k++) {
    const start = directAbs - pre + k * train.period;
    if (start < 0 || start + len > r.length) continue;
    perRepeat.push(r.slice(start, start + len));
  }
  if (!perRepeat.length) throw new Error('Recording too short for the chirp train');
  const corr = new Float64Array(len);
  for (const seg of perRepeat) for (let i = 0; i < len; i++) corr[i] += seg[i] / perRepeat.length;
  return { corr, perRepeat, pre, directAbs, sampleRate: sr };
}

/**
 * What {@link echoResponse} would return for a lone direct path: the chirp's correlation
 * with the template, peak at `pre`. Subtracting it removes the main lobe and sidelobes.
 */
export function directPathModel(
  train: Pick<EchoTrain, 'chirp' | 'template'>,
  length: number,
  pre: number,
) {
  const x = new Float64Array(length + train.chirp.length);
  x.set(train.chirp, pre);
  return crossCorrelate(x, train.template, length - 1);
}

/** Delays `x` by a fractional number of samples (band-limited, via FFT phase; circular). */
export function fractionalShift(x: ArrayLike<number>, delay: number): Float64Array {
  const n = nextPow2(x.length * 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft(re, im);
  for (let k = 0; k <= n / 2; k++) {
    const a = (-2 * Math.PI * k * delay) / n;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const r = re[k] * cs - im[k] * sn;
    const i = re[k] * sn + im[k] * cs;
    re[k] = r;
    im[k] = i;
    // Keep the spectrum Hermitian so the result stays real.
    if (k > 0 && k < n / 2) {
      re[n - k] = r;
      im[n - k] = -i;
    }
  }
  im[n / 2] = 0;
  ifft(re, im);
  return re.slice(0, x.length);
}

function peakPosition(env: ArrayLike<number>, lo: number, hi: number): number {
  let best = Math.max(1, Math.round(lo));
  const end = Math.min(env.length - 1, Math.round(hi));
  for (let i = best; i < end; i++) if (env[i] > env[best]) best = i;
  if (best <= 0 || best >= env.length - 1) return best;
  return best + parabolicPeak(env[best - 1], env[best], env[best + 1]).offset;
}

/** Samples after the direct-path peak used to fit it (its leading edge, before any echo). */
const DIRECT_FIT_AFTER = 2;

/**
 * Default blanking distance without a free-air reference, cm: 3 cm of phone-body and
 * speaker ringing plus two main lobes, where a mismatched pulse model leaves residue.
 * About 17 cm for a 4 kHz ultrasonic band, 9 cm for 2–8 kHz.
 */
export function noReferenceMinCm(
  train: Pick<EchoTrain, 'sampleRate' | 'f0' | 'f1'>,
  speed = speedOfSound(),
) {
  const samplesPerCm = (2 * train.sampleRate) / (100 * speed);
  return 3 + (2 * lobeSamples(train)) / samplesPerCm;
}

/** A pulse shape, and where its own peak sits. */
interface PulseShape {
  real: ArrayLike<number>;
  peak: number;
}

/**
 * Complex least-squares fit of `shape`, moved so its peak is at `position`, to `x` over
 * [position − before, position + after], and its removal. The complex gain absorbs any carrier phase change on
 * reflection; only the real part is subtracted, because `x` is real.
 */
function fitPulse(
  x: ArrayLike<number>,
  shape: PulseShape,
  position: number,
  before: number,
  after = before,
): { model: Float64Array; gain: number } {
  const p = analytic(fractionalShift(shape.real, position - shape.peak));
  const xa = analytic(x);
  const lo = Math.max(0, Math.floor(position - before));
  const hi = Math.min(x.length, Math.ceil(position + after));
  let nr = 0;
  let ni = 0;
  let den = 0;
  for (let i = lo; i < hi; i++) {
    // conj(P)·X
    nr += p.re[i] * xa.re[i] + p.im[i] * xa.im[i];
    ni += p.re[i] * xa.im[i] - p.im[i] * xa.re[i];
    den += p.re[i] * p.re[i] + p.im[i] * p.im[i];
  }
  const gr = den > 0 ? nr / den : 0;
  const gi = den > 0 ? ni / den : 0;
  return {
    model: Float64Array.from({ length: x.length }, (_, i) => gr * p.re[i] - gi * p.im[i]),
    gain: Math.hypot(gr, gi),
  };
}

function removePulse(
  x: ArrayLike<number>,
  shape: PulseShape,
  position: number,
  before: number,
  after = before,
) {
  const { model } = fitPulse(x, shape, position, before, after);
  return Float64Array.from({ length: x.length }, (_, i) => x[i] - model[i]);
}

/**
 * Subtracts a reference response (free-air recording or {@link directPathModel}): shifted
 * so its direct path lines up to a fraction of a sample, scaled by complex least squares
 * over the direct-path lobe.
 */
export function subtractReference(
  corr: ArrayLike<number>,
  reference: ArrayLike<number>,
  pre: number,
  lobe: number,
): Float64Array {
  const w = Math.max(2, Math.round(lobe));
  const pm = peakPosition(envelope(corr), pre - 2 * w, pre + 2 * w);
  const pr = peakPosition(envelope(reference), pre - 2 * w, pre + 2 * w);
  return removePulse(corr, { real: reference, peak: pr }, pm, w, DIRECT_FIT_AFTER);
}

export interface EchoCandidate {
  /** Sub-sample position in the response window. */
  position: number;
  /** Samples after the direct path. */
  delaySamples: number;
  /** One-way distance before the offset correction, cm. */
  rawCm: number;
  /** Envelope level relative to the direct path, dB. */
  levelDb: number;
  /** Envelope level over the noise floor of the search window, dB. */
  snrDb: number;
  prominenceDb: number;
}

export interface EchoAnalysis {
  /** Envelope (after reference subtraction, if any), normalised so the direct path = 1. */
  env: Float64Array;
  /** Envelope of the raw average, same normalisation, for the debug plot. */
  rawEnv: Float64Array;
  directPosition: number;
  /** Window searched for echoes, as indices into `env`. */
  searchFrom: number;
  searchTo: number;
  candidates: EchoCandidate[];
  best: EchoCandidate | null;
  /** best.rawCm + offset, cm. */
  distanceCm: number | null;
  /** Standard error of the echo position across repeats, cm. */
  spreadCm: number;
  floorDb: number;
  /** Strongest other candidate's level relative to the best, dB (−∞ if none). */
  runnerUpDb: number;
  confidence: number;
  usedReference: boolean;
}

export interface EchoAnalysisOptions {
  speed?: number;
  /** Closest distance to consider, cm. Default 3 with a reference, else {@link noReferenceMinCm}. */
  minCm?: number;
  /** Farthest distance to consider, cm. Default 80. */
  maxCm?: number;
  /** Added to the raw distance (speaker/mic geometry; calibrated). Default 0. */
  offsetCm?: number;
  /** A free-air {@link EchoResponse}.corr recorded with the same train. */
  reference?: ArrayLike<number> | null;
  /**
   * Only echoes at least this far above the median floor count. Default 12 dB: noise
   * envelope peaks exceed the median by 6–8 dB often, by 12 dB about 1 in 10⁵ samples.
   */
  minSnrDb?: number;
  /** Pick the candidate nearest this raw distance instead of the strongest. */
  expectRawCm?: number | null;
}

export function analyzeEcho(
  resp: EchoResponse,
  train: Pick<EchoTrain, 'sampleRate' | 'f0' | 'f1' | 'chirp' | 'template'>,
  opts: EchoAnalysisOptions = {},
): EchoAnalysis {
  const sr = resp.sampleRate;
  const c = opts.speed ?? speedOfSound();
  const lobe = lobeSamples(train);
  const w = Math.max(2, Math.round(lobe));
  const pre = resp.pre;
  const corr = resp.corr;
  const useRef = !!opts.reference && opts.reference.length === corr.length;
  const pulseReal = useRef ? opts.reference! : directPathModel(train, corr.length, pre);
  const pulseEnv = envelope(pulseReal);
  const shape: PulseShape = {
    real: pulseReal,
    peak: peakPosition(pulseEnv, pre - 2 * w, pre + 2 * w),
  };
  const pulsePeak = pulseEnv[Math.round(shape.peak)] || 1;

  const samplesPerCm = (2 * sr) / (100 * c);
  const minSnr = opts.minSnrDb ?? 12;
  // Without a reference, the speaker's own ringing (unknown) survives the model
  // subtraction for a few cm, so close echoes can't be trusted.
  const minCm = opts.minCm ?? (useRef ? 3 : noReferenceMinCm(train, c));
  const maxCm = opts.maxCm ?? 80;

  const rawEnvUnscaled = envelope(corr);
  const directLevel =
    Math.max(...rawEnvUnscaled.subarray(Math.max(0, pre - 2 * w), pre + 2 * w)) || 1;
  const rawEnv = rawEnvUnscaled.map((v) => v / directLevel);

  // CLEAN: repeatedly take the strongest envelope peak, fit the pulse shape there (complex
  // gain) and subtract it. Then RELAX: re-locate each component with all the others
  // removed, which untangles overlapping main lobes (the direct path and a close echo).
  const half = Math.max(2, Math.round(w / 2));
  const lastIndex = Math.min(corr.length - 2, Math.round(pre + (maxCm + 5) * samplesPerCm));
  const comps: { position: number; model: Float64Array; gain: number }[] = [];
  let residual = Float64Array.from(corr);
  const noiseEnv = (x: Float64Array) =>
    median(envelope(x).subarray(Math.round(pre + 2 * w), lastIndex));
  for (let k = 0; k < 10; k++) {
    const env = envelope(residual);
    const pos = peakPosition(env, pre - 2 * w, lastIndex);
    // Stop once the strongest thing left is noise.
    if (env[Math.round(pos)] < Math.pow(10, minSnr / 20) * noiseEnv(residual)) break;
    const { model, gain } = fitPulse(residual, shape, pos, half);
    comps.push({ position: pos, model, gain });
    residual = residual.map((v, i) => v - model[i]);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < comps.length; i++) {
      const others = Float64Array.from(corr);
      for (let j = 0; j < comps.length; j++) {
        if (j !== i) for (let n = 0; n < others.length; n++) others[n] -= comps[j].model[n];
      }
      const p = comps[i].position;
      const pos = peakPosition(envelope(others), p - half, p + half + 1);
      comps[i] = { position: pos, ...fitPulse(others, shape, pos, half) };
    }
  }
  residual = Float64Array.from(corr);
  for (const k of comps) for (let n = 0; n < residual.length; n++) residual[n] -= k.model[n];

  // The direct path is the strongest component near `pre`; it sets time zero.
  const near = comps.filter((k) => Math.abs(k.position - pre) <= 2 * w);
  const direct = near.length
    ? near.reduce((a, b) => (b.gain > a.gain ? b : a))
    : {
        position: peakPosition(rawEnvUnscaled, pre - 2 * w, pre + 2 * w),
        gain: directLevel / pulsePeak,
        model: new Float64Array(corr.length),
      };
  const directPosition = direct.position;
  const searchFrom = Math.max(1, Math.round(directPosition + minCm * samplesPerCm));
  const searchTo = Math.min(corr.length - 1, Math.round(directPosition + maxCm * samplesPerCm));

  const env = envelope(Float64Array.from(corr, (v, i) => v - direct.model[i])).map(
    (v) => v / directLevel,
  );
  const floorAmp =
    (median(envelope(residual).subarray(searchFrom, Math.max(searchFrom + 1, searchTo))) || 1e-12) /
    directLevel;
  const floorDb = ampToDb(floorAmp);
  const toLevel = (gain: number) => (gain * pulsePeak) / directLevel;

  const candidates: EchoCandidate[] = comps
    .filter((k) => k !== direct && k.position >= searchFrom && k.position <= searchTo)
    .map((k) => {
      const delaySamples = k.position - directPosition;
      const levelDb = ampToDb(toLevel(k.gain));
      return {
        position: k.position,
        delaySamples,
        rawCm: delaySamples / samplesPerCm,
        levelDb,
        snrDb: levelDb - floorDb,
        prominenceDb: levelDb - floorDb,
      };
    })
    .filter((k) => k.snrDb >= minSnr)
    .sort((a, b) => b.levelDb - a.levelDb);

  let best = candidates[0] ?? null;
  if (best && opts.expectRawCm != null) {
    const e = opts.expectRawCm;
    // Within 6 dB of the strongest, prefer the one nearest the expectation.
    best = candidates
      .filter((k) => k.levelDb >= candidates[0].levelDb - 6)
      .sort((a, b) => Math.abs(a.rawCm - e) - Math.abs(b.rawCm - e))[0];
  }
  const runnerUpDb = best
    ? Math.max(
        -Infinity,
        ...candidates.filter((k) => k !== best).map((k) => k.levelDb - best.levelDb),
      )
    : -Infinity;

  // Repeat-to-repeat scatter of the echo position (standard error over N repeats): remove
  // every other component's (averaged) model from each repeat, then re-locate the echo.
  let spreadCm = 0;
  if (best && resp.perRepeat.length > 1) {
    const bestComp = comps.find((k) => k.position === best.position)!;
    const positions = resp.perRepeat.map((seg) => {
      const x = Float64Array.from(seg);
      for (const k of comps)
        if (k !== bestComp) for (let n = 0; n < x.length; n++) x[n] -= k.model[n];
      return peakPosition(envelope(x), best.position - half, best.position + half + 1);
    });
    const mu = positions.reduce((a, b) => a + b, 0) / positions.length;
    const sd = Math.sqrt(positions.reduce((a, b) => a + (b - mu) ** 2, 0) / (positions.length - 1));
    spreadCm = sd / Math.sqrt(positions.length) / samplesPerCm;
  }

  let confidence = 0;
  if (best) {
    confidence = clamp((best.snrDb - minSnr) / 14, 0, 1);
    confidence *= Math.exp(-spreadCm / 0.5);
    // A second echo almost as strong makes the choice ambiguous.
    confidence *= runnerUpDb > -3 ? 0.5 : runnerUpDb > -6 ? 0.8 : 1;
    // Without a free-air reference, the phone's own ringing can masquerade as a close echo.
    confidence *= useRef ? 1 : 0.85;
  }

  return {
    env,
    rawEnv,
    directPosition,
    searchFrom,
    searchTo,
    candidates,
    best,
    distanceCm: best ? best.rawCm + (opts.offsetCm ?? 0) : null,
    spreadCm,
    floorDb,
    runnerUpDb,
    confidence: clamp(confidence, 0, 1),
    usedReference: useRef,
  };
}
