import { pchip, linearFit } from './fit';
import { detectOnsets, type OnsetOptions } from './onset';
import { estimateResonance, type ResonanceResult } from './resonance';
import { clamp, mad, median } from './stats';

/**
 * Calibrated-tap liquid level.
 *
 * Tapping a container excites wall vibration modes. Liquid in contact with the wall adds
 * mass to the vibrating system without adding much stiffness, so each mode's frequency
 * drops as the container fills (French, "In vino veritas", Am. J. Phys. 1983, for a
 * wine glass: (f₀/f)² = 1 + α(h/H)⁴). Real buckets are not ideal shells, so we don't
 * predict from first principles. We calibrate each container with known fills and fit
 * a curve.
 */

export interface TapReading {
  onsetS: number;
  frequency: number;
  snrDb: number;
  q: number;
  resonance: ResonanceResult;
}

export interface TapAnalysisOptions {
  fMin?: number;
  fMax?: number;
  /** Minimum peak SNR for a tap to count. Default 10 dB. */
  minSnrDb?: number;
  onset?: OnsetOptions;
}

/** Finds every tap in a recording and estimates each one's dominant resonance. */
export function analyzeTaps(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: TapAnalysisOptions = {},
): { taps: TapReading[]; onsetsS: number[] } {
  const onsets = detectOnsets(x, sampleRate, opts.onset);
  const taps: TapReading[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const start = onsets[i].sample;
    const end = Math.min(
      x.length,
      onsets[i + 1]?.sample ?? x.length,
      start + Math.round(0.25 * sampleRate),
    );
    const seg = Array.prototype.slice.call(x, start, end) as number[];
    const r = estimateResonance(seg, sampleRate, { fMin: opts.fMin, fMax: opts.fMax });
    if (!r || r.snrDb < (opts.minSnrDb ?? 10)) continue;
    taps.push({
      onsetS: onsets[i].time,
      frequency: r.frequency,
      snrDb: r.snrDb,
      q: r.q,
      resonance: r,
    });
  }
  return { taps, onsetsS: onsets.map((o) => o.time) };
}

export interface TapSummary {
  /** Robust central frequency of the consistent taps, Hz. */
  frequency: number;
  /** Robust spread (≈σ) of those taps, Hz. */
  spreadHz: number;
  /** Taps that agreed with the median. */
  used: number;
  /** Taps rejected as a different mode or a mis-hit. */
  rejected: number;
  snrDb: number;
}

/**
 * Combines several taps. Taps that excite a different mode (a frequency far from the
 * median) are dropped instead of averaged in.
 */
export function summarizeTaps(taps: TapReading[], toleranceRel = 0.03): TapSummary | null {
  if (!taps.length) return null;
  const freqs = taps.map((t) => t.frequency);
  const m = median(freqs);
  const tol = Math.max(toleranceRel * m, 3 * 1.4826 * mad(freqs));
  const inliers = taps.filter((t) => Math.abs(t.frequency - m) <= tol);
  const f = inliers.map((t) => t.frequency);
  return {
    frequency: median(f),
    spreadHz: f.length > 1 ? Math.max(1.4826 * mad(f), stdev(f) / 2) : 0,
    used: inliers.length,
    rejected: taps.length - inliers.length,
    snrDb: median(inliers.map((t) => t.snrDb)),
  };
}

function stdev(x: number[]) {
  const mu = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, x.length - 1));
}

export interface TapCalibrationPoint {
  litres: number;
  frequency: number;
}

export type TapModel =
  /** (f₀/f)² − 1 = α·Vᵏ, physics-shaped; needs an empty (0 L) point. */
  | { kind: 'power'; f0: number; alpha: number; k: number }
  /** Monotone cubic through the points (no empty point, or the power law didn't fit). */
  | { kind: 'interp'; points: TapCalibrationPoint[] };

export interface TapFit {
  model: TapModel;
  predict: (frequency: number) => number;
  /** Calibrated frequency range, Hz. */
  rangeHz: [number, number];
  maxLitres: number;
  /** RMS litres error at the calibration points (0 when the fit is exact). */
  residualRmsLitres: number;
  /** Suggested resonance search band for this container, Hz. */
  searchBand: [number, number];
}

/** Fits litres = g(frequency) from calibration points. Needs ≥2 distinct frequencies. */
export function fitTapCalibration(points: TapCalibrationPoint[]): TapFit {
  const pts = mergeDuplicates(points);
  if (pts.length < 2) throw new Error('Need at least two calibration points with different fills');
  const freqs = pts.map((p) => p.frequency);
  const fLo = Math.min(...freqs);
  const fHi = Math.max(...freqs);
  if (fHi - fLo < 0.002 * fHi) {
    throw new Error(
      'Calibration points have the same pitch; this container may not be tap-measurable',
    );
  }

  const model = fitPower(pts) ?? { kind: 'interp' as const, points: pts };
  const predict = predictor(model);
  const residualRmsLitres = Math.sqrt(
    pts.reduce((a, p) => a + (predict(p.frequency) - p.litres) ** 2, 0) / pts.length,
  );
  return {
    model,
    predict,
    rangeHz: [fLo, fHi],
    maxLitres: Math.max(...pts.map((p) => p.litres)),
    residualRmsLitres,
    searchBand: [Math.max(60, fLo * 0.7), Math.min(10000, fHi * 1.3)],
  };
}

function mergeDuplicates(points: TapCalibrationPoint[]): TapCalibrationPoint[] {
  const byLitres = new Map<number, number[]>();
  for (const p of points) {
    if (!(p.frequency > 0) || !(p.litres >= 0)) continue;
    const key = Math.round(p.litres * 1000) / 1000;
    byLitres.set(key, [...(byLitres.get(key) ?? []), p.frequency]);
  }
  return [...byLitres.entries()]
    .map(([litres, fs]) => ({ litres, frequency: median(fs) }))
    .sort((a, b) => a.litres - b.litres);
}

function fitPower(pts: TapCalibrationPoint[]): TapModel | null {
  const empty = pts.find((p) => p.litres === 0);
  const filled = pts.filter((p) => p.litres > 0);
  if (!empty || !filled.length) return null;
  const f0 = empty.frequency;
  const ys = filled.map((p) => (f0 / p.frequency) ** 2 - 1);
  if (ys.some((y) => y <= 0)) return null; // pitch didn't drop with fill: not this physics
  if (filled.length === 1) {
    // One filled point: assume added mass ∝ volume (k = 1).
    return { kind: 'power', f0, alpha: ys[0] / filled[0].litres, k: 1 };
  }
  const fit = linearFit(
    filled.map((p) => Math.log(p.litres)),
    ys.map((y) => Math.log(y)),
  );
  const k = fit.slope;
  if (!(k > 0.3 && k < 8)) return null;
  return { kind: 'power', f0, alpha: Math.exp(fit.intercept), k };
}

function predictor(model: TapModel): (f: number) => number {
  if (model.kind === 'power') {
    const { f0, alpha, k } = model;
    return (f) => {
      const y = (f0 / f) ** 2 - 1;
      return y <= 0 ? 0 : Math.pow(y / alpha, 1 / k);
    };
  }
  const interp = pchip(
    model.points.map((p) => p.frequency),
    model.points.map((p) => p.litres),
  );
  return (f) => Math.max(0, interp(f));
}

export interface TapEstimate {
  litres: number;
  /** ± litres, from tap-to-tap pitch spread propagated through the curve. */
  uncertaintyLitres: number;
  /** 0..1 heuristic (see docs/tap-level.md). */
  confidence: number;
  inRange: boolean;
}

export function estimateLitresFromTaps(
  fit: TapFit,
  summary: TapSummary,
  capacityLitres?: number,
): TapEstimate {
  const cap = capacityLitres ?? fit.maxLitres * 1.25;
  const f = summary.frequency;
  const litres = clamp(fit.predict(f), 0, cap);
  // Slope of the curve by central difference.
  const h = Math.max(0.5, f * 0.002);
  const slope = Math.abs(fit.predict(f + h) - fit.predict(f - h)) / (2 * h);
  const uncertaintyLitres = slope * Math.max(summary.spreadHz, f * 0.002) + fit.residualRmsLitres;
  const [lo, hi] = fit.rangeHz;
  const inRange = f >= lo * 0.98 && f <= hi * 1.02;

  const rel = summary.spreadHz / f;
  let confidence = Math.exp(-rel / 0.01);
  confidence *= summary.used >= 3 ? 1 : summary.used === 2 ? 0.8 : 0.55;
  confidence *= inRange ? 1 : 0.6;
  confidence *= clamp((summary.snrDb - 10) / 20, 0.3, 1);
  confidence *= summary.rejected > summary.used ? 0.6 : 1;
  return { litres, uncertaintyLitres, confidence: clamp(confidence, 0, 1), inRange };
}
