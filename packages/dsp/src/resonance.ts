import { magnitudeSpectrum } from './spectrum';
import { findPeaks } from './peaks';
import { ampToDb, mad, median } from './stats';

export interface SpectralPeak {
  frequency: number;
  magnitudeDb: number;
  prominenceDb: number;
}

export interface ResonanceResult {
  /** Dominant resonant frequency, Hz (sub-bin interpolated). */
  frequency: number;
  magnitudeDb: number;
  /** Peak height above the median spectrum level in the search band, dB. */
  snrDb: number;
  /** −3 dB bandwidth, Hz (includes window broadening; treat as an upper bound). */
  bandwidthHz: number;
  /** f / bandwidth. */
  q: number;
  /** The strongest few peaks, strongest first, so callers can track a particular mode. */
  peaks: SpectralPeak[];
}

export interface ResonanceOptions {
  fMin?: number;
  fMax?: number;
  /** Skip this long after the onset so the broadband impact click is excluded. Default 3 ms. */
  skipS?: number;
  /** Analysis window length. Default 120 ms. */
  windowS?: number;
  /** Zero-padding factor for finer bin spacing. Default 8. */
  zeroPad?: number;
  maxPeaks?: number;
}

/**
 * Finds the dominant ringing frequency after a tap. Hann window, zero-padded FFT, then a
 * parabola through the log-magnitude of the top three bins (sub-bin accuracy).
 * `x` should start at the tap onset.
 */
export function estimateResonance(
  x: ArrayLike<number>,
  sampleRate: number,
  opts: ResonanceOptions = {},
): ResonanceResult | null {
  const skip = Math.round((opts.skipS ?? 0.003) * sampleRate);
  const len = Math.min(x.length - skip, Math.round((opts.windowS ?? 0.12) * sampleRate));
  if (len < 64) return null;
  const seg = Array.prototype.slice.call(x, skip, skip + len) as number[];
  const spec = magnitudeSpectrum(seg, sampleRate, { window: 'hann', zeroPad: opts.zeroPad ?? 8 });
  const db = Float64Array.from(spec.mags, (m) => ampToDb(m));

  const fMin = opts.fMin ?? 80;
  const fMax = Math.min(opts.fMax ?? 8000, sampleRate / 2);
  const start = Math.max(1, Math.ceil(fMin / spec.binHz));
  const end = Math.min(db.length - 1, Math.floor(fMax / spec.binHz));
  if (end - start < 3) return null;

  const band = db.subarray(start, end);
  const floorDb = median(band);
  const spreadDb = Math.max(1, 1.4826 * mad(band));
  // Peaks closer than ~1.5 un-padded bins are the same lobe.
  const lobe = Math.ceil((1.5 * sampleRate) / len / spec.binHz);
  const peaks = findPeaks(db, {
    start,
    end,
    minProminence: Math.max(3, spreadDb),
    minDistance: lobe,
    maxPeaks: opts.maxPeaks ?? 5,
  });
  const top = peaks[0];
  if (!top) return null;

  const frequency = top.position * spec.binHz;
  // −3 dB points by linear interpolation on the dB curve.
  const half = top.value - 3;
  let l = top.index;
  while (l > start && db[l] > half) l--;
  let r = top.index;
  while (r < end && db[r] > half) r++;
  const lx = l + (half - db[l]) / (db[l + 1] - db[l] || 1);
  const rx = r - 1 + (db[r - 1] - half) / (db[r - 1] - db[r] || 1);
  const bandwidthHz = Math.max(spec.binHz, (rx - lx) * spec.binHz);

  return {
    frequency,
    magnitudeDb: top.value,
    snrDb: top.value - floorDb,
    bandwidthHz,
    q: frequency / bandwidthHz,
    peaks: peaks.map((p) => ({
      frequency: p.position * spec.binHz,
      magnitudeDb: p.value,
      prominenceDb: p.prominence,
    })),
  };
}
