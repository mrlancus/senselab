import { magnitudeSpectrum } from './spectrum';
import { mean, median } from './stats';

/**
 * Knock ID: what an object sounds like when knocked, as a small feature vector, and a
 * k-nearest-neighbour classifier over examples the user teaches.
 *
 * Features (from the first 120 ms after the onset):
 * - 16 overlapping log-spaced band levels, 100 Hz to 8 kHz, in dB with their mean removed
 *   and the noise floor clamped (25 dB under the loudest band): the spectral *shape*, so
 *   how hard you knock doesn't matter.
 * - Spectral centroid and dominant peak frequency, as log₂ Hz (brightness, pitch).
 * - Ring-down: time for the envelope to fall 20 dB, as log₂ s (glass rings, cardboard
 *   thuds).
 * - Tonality: dominant peak over the median band level, dB.
 * - Optional IMU: peak acceleration (m/s², log₂) while the phone touches the object.
 */

export const KNOCK_FEATURE_VERSION = 1;
export const KNOCK_BANDS = 16;

export interface KnockFeatures {
  version: number;
  /** The vector the classifier uses (IMU appended only if present). */
  vector: number[];
  bandsDb: number[];
  centroidHz: number;
  peakHz: number;
  decayS: number;
  tonalityDb: number;
  imuPeak: number | null;
}

export function knockFeatures(
  seg: ArrayLike<number>,
  sampleRate: number,
  imuPeak: number | null = null,
): KnockFeatures {
  const n = Math.min(seg.length, Math.round(0.12 * sampleRate));
  const x = Array.prototype.slice.call(seg, 0, n) as number[];
  const spec = magnitudeSpectrum(x, sampleRate, { window: 'hann', zeroPad: 2 });
  const fLo = 100;
  const fHi = Math.min(8000, 0.45 * sampleRate);
  // Overlapping triangular bands, evenly spaced in log frequency: a tone near a band edge
  // splits between two bands instead of jumping from one to the other.
  const step = Math.log(fHi / fLo) / (KNOCK_BANDS - 1);
  const power = spec.mags.map((m) => m * m);
  const bandPow = new Array<number>(KNOCK_BANDS).fill(0);
  const bandW = new Array<number>(KNOCK_BANDS).fill(0);
  for (let k = 1; k < power.length; k++) {
    const f = k * spec.binHz;
    if (f < fLo / Math.exp(step) || f > fHi * Math.exp(step)) continue;
    const pos = Math.log(f / fLo) / step; // band index, fractional
    const i0 = Math.floor(pos);
    for (const i of [i0, i0 + 1]) {
      if (i < 0 || i >= KNOCK_BANDS) continue;
      const w = 1 - Math.abs(pos - i);
      if (w <= 0) continue;
      bandPow[i] += w * power[k];
      bandW[i] += w;
    }
  }
  for (let i = 0; i < KNOCK_BANDS; i++) bandPow[i] /= Math.max(1e-9, bandW[i]);
  // Bands more than 25 dB under the loudest are at the noise floor; clamp them so a soft
  // knock (lower SNR) has the same shape as a hard one.
  const loud = Math.max(...bandPow.map((p) => 10 * Math.log10(p + 1e-20)));
  const bandDbRaw = bandPow.map((p) => Math.max(loud - 25, 10 * Math.log10(p + 1e-20)));
  const mu = mean(bandDbRaw);
  const bandsDb = bandDbRaw.map((v) => v - mu);

  let num = 0;
  let den = 0;
  let peakK = 1;
  for (let k = Math.ceil(fLo / spec.binHz); k * spec.binHz <= fHi && k < power.length; k++) {
    num += power[k] * k * spec.binHz;
    den += power[k];
    if (power[k] > power[peakK]) peakK = k;
  }
  const centroidHz = den > 0 ? num / den : fLo;
  const peakHz = peakK * spec.binHz;
  const tonalityDb = 10 * Math.log10((power[peakK] + 1e-20) / (median(bandPow) + 1e-20));

  // Ring-down from 5 ms RMS frames over the whole segment (up to 300 ms).
  const frame = Math.max(1, Math.round(0.005 * sampleRate));
  const env: number[] = [];
  for (let i = 0; i + frame <= Math.min(seg.length, Math.round(0.3 * sampleRate)); i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) s += seg[j] * seg[j];
    env.push(s / frame);
  }
  let pk = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[pk]) pk = i;
  let end = pk;
  while (end + 1 < env.length && env[end + 1] > env[pk] / 100) end++;
  const decayS = Math.max(frame / sampleRate, ((end - pk + 1) * frame) / sampleRate);

  const scalars = [Math.log2(centroidHz), Math.log2(peakHz), Math.log2(decayS), tonalityDb / 10];
  const vector = [...bandsDb.map((v) => v / 10), ...scalars];
  if (imuPeak != null) vector.push(Math.log2(Math.max(0.01, imuPeak)));
  return {
    version: KNOCK_FEATURE_VERSION,
    vector,
    bandsDb,
    centroidHz,
    peakHz,
    decayS,
    tonalityDb,
    imuPeak,
  };
}

export interface KnockExample {
  id?: string;
  label: string;
  features: KnockFeatures;
}

export interface KnockModel {
  examples: KnockExample[];
  /** Per-dimension mean and spread used to standardise. */
  mu: number[];
  sigma: number[];
  weights: number[];
  dims: number;
  /** Median distance from an example to its nearest same-label neighbour (all labels). */
  typicalDistance: number;
  /** The same, per label (labels with one example use the overall value). */
  typicalByLabel: Record<string, number>;
  labels: string[];
}

/**
 * Band levels share one weight budget (each band ¼ as much as a scalar feature), so the 16
 * correlated bands don't drown out decay and pitch.
 */
function weightsFor(dims: number) {
  return Array.from({ length: dims }, (_, i) => (i < KNOCK_BANDS ? 0.25 : 1));
}

export function trainKnock(all: KnockExample[]): KnockModel {
  const usable = all.filter((e) => e.features.version === KNOCK_FEATURE_VERSION);
  // Use the IMU dimension only if every example has it.
  const withImu = usable.length > 0 && usable.every((e) => e.features.imuPeak != null);
  const dims = KNOCK_BANDS + 4 + (withImu ? 1 : 0);
  const examples = usable.map((e) => ({
    ...e,
    features: { ...e.features, vector: e.features.vector.slice(0, dims) },
  }));
  const mu = Array.from({ length: dims }, (_, d) =>
    mean(examples.map((e) => e.features.vector[d])),
  );
  const sigma = Array.from({ length: dims }, (_, d) => {
    const v = examples.map((e) => e.features.vector[d]);
    const m = mu[d];
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
    // Floor: smaller differences are noise (0.5 dB for levels, 1/20 octave for pitches).
    return Math.max(sd, 0.05);
  });
  const model: KnockModel = {
    examples,
    mu,
    sigma,
    weights: weightsFor(dims),
    dims,
    typicalDistance: 1,
    typicalByLabel: {},
    labels: [...new Set(examples.map((e) => e.label))].sort(),
  };
  const nn = examples.map((e, i) => {
    const same = examples.filter((o, j) => j !== i && o.label === e.label);
    return same.length
      ? Math.min(...same.map((o) => distance(model, e.features, o.features)))
      : NaN;
  });
  const finite = nn.filter((d) => Number.isFinite(d));
  model.typicalDistance = finite.length ? Math.max(0.5, median(finite)) : 1;
  for (const label of model.labels) {
    const d = nn.filter((v, i) => examples[i].label === label && Number.isFinite(v));
    model.typicalByLabel[label] = d.length ? Math.max(0.5, median(d)) : model.typicalDistance;
  }
  return model;
}

export function distance(m: KnockModel, a: KnockFeatures, b: KnockFeatures): number {
  let s = 0;
  for (let d = 0; d < m.dims; d++) {
    const va = a.vector[d];
    const vb = b.vector[d];
    if (va == null || vb == null) continue;
    s += m.weights[d] * ((va - vb) / m.sigma[d]) ** 2;
  }
  return Math.sqrt(s);
}

export interface KnockGuess {
  label: string | null;
  /** Share of the distance-weighted vote, 0..1. */
  confidence: number;
  /** Nearest example's distance over the typical same-label spacing; > 3 = unlike anything taught. */
  novelty: number;
  neighbours: { label: string; distance: number }[];
  votes: Record<string, number>;
}

export function classifyKnock(m: KnockModel, f: KnockFeatures, k = 3): KnockGuess {
  if (!m.examples.length)
    return { label: null, confidence: 0, novelty: Infinity, neighbours: [], votes: {} };
  const ranked = m.examples
    .map((e) => ({ label: e.label, distance: distance(m, f, e.features) }))
    .sort((a, b) => a.distance - b.distance);
  const top = ranked.slice(0, Math.min(k, ranked.length));
  const votes: Record<string, number> = {};
  for (const n of top)
    votes[n.label] = (votes[n.label] ?? 0) + 1 / (n.distance + 0.1 * m.typicalDistance);
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  const [label, score] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  // How far the nearest example is, in units of that label's own spread.
  const novelty = top[0].distance / (m.typicalByLabel[top[0].label] ?? m.typicalDistance);
  return {
    label: novelty > 3 ? null : label,
    confidence: (score / total) * (novelty > 2 ? 0.6 : 1),
    novelty,
    neighbours: top,
    votes,
  };
}

/** Leave-one-out accuracy: how well the taught examples separate (needs ≥ 2 labels). */
export function leaveOneOut(all: KnockExample[], k = 3): number | null {
  const labels = new Set(all.map((e) => e.label));
  if (labels.size < 2 || all.length < 3) return null;
  let right = 0;
  for (let i = 0; i < all.length; i++) {
    const rest = all.filter((_, j) => j !== i);
    const g = classifyKnock(trainKnock(rest), all[i].features, k);
    if (g.label === all[i].label) right++;
  }
  return right / all.length;
}

/**
 * Acoustic firmness of a fruit (Abbott et al.; Yamamoto et al. 1980): S = f² · m^(2/3), with
 * f the first resonance in Hz and m the mass in kg. Fruit softens as it ripens, so S falls.
 * Values depend on the variety, so compare the same kind of fruit, ideally over days.
 */
export function firmnessIndex(frequencyHz: number, massKg: number): number {
  return frequencyHz * frequencyHz * Math.pow(massKg, 2 / 3);
}
