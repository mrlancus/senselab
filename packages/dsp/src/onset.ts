import { maxAbs, median, toDb } from './stats';

export interface Onset {
  /** Sample index where the transient starts. */
  sample: number;
  time: number;
  /** Frame energy above the background, dB. */
  strengthDb: number;
}

export interface OnsetOptions {
  frameSize?: number;
  hop?: number;
  /** Energy must exceed background by this many dB. Default 15. */
  thresholdDb?: number;
  /** Energy must jump by this many dB versus `riseLookback` frames earlier. Default 9. */
  riseDb?: number;
  riseLookback?: number;
  /** Minimum time between onsets, seconds. Default 0.12 (ignores ringing and bounces). */
  minGapS?: number;
  /** Absolute RMS floor, so silence plus a tiny click doesn't count. Default 0.002. */
  absoluteFloor?: number;
}

/**
 * Energy-based transient detector, tuned for taps and knocks: short frames, a robust
 * background estimate (median energy), and a "sharp rise" test so the decaying tail of a
 * tap is not reported as a new tap.
 */
export function detectOnsets(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: OnsetOptions = {},
): Onset[] {
  const frameSize = opts.frameSize ?? 256;
  const hop = opts.hop ?? 128;
  const thrRatio = Math.pow(10, (opts.thresholdDb ?? 15) / 10);
  const riseRatio = Math.pow(10, (opts.riseDb ?? 9) / 10);
  const lookback = opts.riseLookback ?? 3;
  const minGap = Math.round((opts.minGapS ?? 0.12) * sampleRate);
  const floor = (opts.absoluteFloor ?? 0.002) ** 2;

  const energies: number[] = [];
  for (let start = 0; start + frameSize <= x.length; start += hop) {
    let s = 0;
    for (let i = start; i < start + frameSize; i++) s += x[i] * x[i];
    energies.push(s / frameSize);
  }
  if (!energies.length) return [];
  const background = Math.max(median(energies), 1e-12);
  const threshold = Math.max(background * thrRatio, floor);
  const noiseAmp = Math.sqrt(background);

  const onsets: Onset[] = [];
  let lastSample = -Infinity;
  for (let f = 0; f < energies.length; f++) {
    const e = energies[f];
    if (e < threshold) continue;
    const before = f >= lookback ? energies[f - lookback] : background;
    if (e < riseRatio * Math.max(before, background)) continue;

    // Refine to the first sample that clearly rises above the noise.
    const lo = Math.max(0, f * hop - frameSize);
    const hi = Math.min(x.length, f * hop + frameSize);
    const peak = maxAbs(x, lo, hi);
    const level = Math.max(0.2 * peak, 4 * noiseAmp);
    let sample = lo;
    while (sample < hi && Math.abs(x[sample]) < level) sample++;
    if (sample - lastSample < minGap) continue;

    // Report the strongest frame in the next few as the strength.
    let maxE = e;
    for (let g = f + 1; g < Math.min(energies.length, f + 4); g++)
      maxE = Math.max(maxE, energies[g]);
    onsets.push({ sample, time: sample / sampleRate, strengthDb: toDb(maxE / background) });
    lastSample = sample;
  }
  return onsets;
}
