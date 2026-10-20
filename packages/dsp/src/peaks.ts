export interface Peak {
  /** Integer index of the local maximum. */
  index: number;
  /** Sub-sample position from parabolic interpolation. */
  position: number;
  /** Interpolated peak value. */
  value: number;
  /** Height above the higher of the two surrounding minima (as in scipy.signal.find_peaks). */
  prominence: number;
}

export interface FindPeaksOptions {
  minHeight?: number;
  minProminence?: number;
  /** Minimum separation in samples; the higher peak wins. */
  minDistance?: number;
  maxPeaks?: number;
  start?: number;
  end?: number;
}

/**
 * Vertex of the parabola through (−1, a), (0, b), (1, c).
 * Returns the offset in [−0.5, 0.5] and the interpolated height.
 */
export function parabolicPeak(a: number, b: number, c: number): { offset: number; value: number } {
  const denom = a - 2 * b + c;
  if (denom === 0) return { offset: 0, value: b };
  const offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  return { offset, value: b - 0.25 * (a - c) * offset };
}

export function argMax(y: ArrayLike<number>, start = 0, end = y.length): number {
  let best = start;
  for (let i = start + 1; i < end; i++) if (y[i] > y[best]) best = i;
  return best;
}

/** Local maxima, sorted by value descending. */
export function findPeaks(y: ArrayLike<number>, opts: FindPeaksOptions = {}): Peak[] {
  const start = Math.max(1, opts.start ?? 0);
  const end = Math.min(y.length - 1, opts.end ?? y.length);
  const minHeight = opts.minHeight ?? -Infinity;
  const candidates: number[] = [];
  for (let i = start; i < end; i++) {
    if (y[i] < minHeight) continue;
    if (y[i] > y[i - 1] && y[i] >= y[i + 1]) {
      // Plateau: take its centre only once.
      if (y[i] === y[i + 1]) {
        let j = i;
        while (j + 1 < y.length && y[j + 1] === y[i]) j++;
        if (j + 1 < y.length && y[j + 1] > y[i]) continue;
        candidates.push((i + j) >> 1);
        i = j;
      } else {
        candidates.push(i);
      }
    }
  }

  const lo = opts.start ?? 0;
  const hi = opts.end ?? y.length;
  const peaks: Peak[] = candidates.map((i) => {
    // Prominence: walk outwards until a higher sample or the range edge.
    let leftMin = y[i];
    for (let j = i - 1; j >= lo; j--) {
      if (y[j] > y[i]) break;
      if (y[j] < leftMin) leftMin = y[j];
    }
    let rightMin = y[i];
    for (let j = i + 1; j < hi; j++) {
      if (y[j] > y[i]) break;
      if (y[j] < rightMin) rightMin = y[j];
    }
    const { offset, value } = parabolicPeak(y[i - 1], y[i], y[i + 1]);
    return {
      index: i,
      position: i + offset,
      value,
      prominence: y[i] - Math.max(leftMin, rightMin),
    };
  });

  let result = peaks.filter((p) => p.prominence >= (opts.minProminence ?? 0));
  result.sort((a, b) => b.value - a.value);
  const minDistance = opts.minDistance ?? 1;
  if (minDistance > 1) {
    const kept: Peak[] = [];
    for (const p of result) {
      if (kept.every((k) => Math.abs(k.index - p.index) >= minDistance)) kept.push(p);
    }
    result = kept;
  }
  return opts.maxPeaks ? result.slice(0, opts.maxPeaks) : result;
}
