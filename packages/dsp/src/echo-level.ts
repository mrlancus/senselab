import { pchip } from './fit';
import { frustumLevelForLitres, frustumLitresAtLevel, type FrustumCm } from './geometry';
import { clamp, median } from './stats';

/**
 * Echo distance → litres. The phone is held above the open container, bottom edge (speaker
 * and mic) pointing down, and measures the distance to the water surface.
 *
 * - With the container's inside dimensions: depth = H − (raw + offset), and litres follow
 *   from the frustum. `offset` is the phone's height above the rim plus a small
 *   speaker/mic geometry term. Every echo calibration point (including "empty", which
 *   measures the bottom) gives one estimate of it; we take the median.
 * - Without dimensions: monotone interpolation of litres against raw distance through the
 *   calibration points (needs two).
 */

/**
 * Offset assumed with no calibration point, cm. The phone's bottom edge is at the rim and the
 * speaker and mic are ~2 cm apart: the echo path is 2·√(d² + (s/2)²) − s ≈ 2d − s, so
 * d ≈ raw + s/2.
 */
export const DEFAULT_ECHO_OFFSET_CM = 1;
/** Uncertainty of that assumption (hand height, phone geometry), cm. */
export const DEFAULT_ECHO_OFFSET_SIGMA_CM = 1.5;

export interface EchoCalibrationPoint {
  litres: number;
  rawCm: number;
}

export interface EchoLevelFit {
  kind: 'shape' | 'interp';
  offsetCm: number;
  /** ± on the offset: the spread of the calibration points, or the default's σ. */
  offsetSigmaCm: number;
  calibrated: boolean;
  /**
   * Raw distances that make sense: for `shape`, the water between the rim and the bottom
   * (2 cm slack); for `interp`, the calibrated range ± 1 cm.
   */
  rangeCm: [number, number];
  predict: (rawCm: number) => { litres: number; depthCm: number | null };
  /** |dV/d(distance)| at a raw distance, litres per cm. */
  slope: (rawCm: number) => number;
}

export function fitEchoLevel(
  points: EchoCalibrationPoint[],
  shape?: FrustumCm | null,
): EchoLevelFit | null {
  const pts = points.filter((p) => p.litres >= 0 && p.rawCm > 0);
  if (shape) {
    const offsets = pts.map(
      (p) => shape.heightCm - frustumLevelForLitres(shape, p.litres) - p.rawCm,
    );
    const calibrated = offsets.length > 0;
    const offsetCm = calibrated ? median(offsets) : DEFAULT_ECHO_OFFSET_CM;
    const offsetSigmaCm =
      offsets.length > 1
        ? Math.max(0.2, 1.4826 * median(offsets.map((o) => Math.abs(o - offsetCm))))
        : calibrated
          ? 0.3
          : DEFAULT_ECHO_OFFSET_SIGMA_CM;
    const depthAt = (raw: number) => clamp(shape.heightCm - (raw + offsetCm), 0, shape.heightCm);
    return {
      kind: 'shape',
      offsetCm,
      offsetSigmaCm,
      calibrated,
      rangeCm: [-offsetCm - 2, shape.heightCm - offsetCm + 2],
      predict: (raw) => {
        const depthCm = depthAt(raw);
        return { litres: frustumLitresAtLevel(shape, depthCm), depthCm };
      },
      slope: (raw) => {
        const h = depthAt(raw);
        const r =
          shape.bottomDiameterCm / 2 +
          ((shape.topDiameterCm - shape.bottomDiameterCm) / 2) * (h / shape.heightCm);
        return (Math.PI * r * r) / 1000;
      },
    };
  }

  // No dimensions: litres against raw distance.
  const byRaw = [...pts].sort((a, b) => a.rawCm - b.rawCm);
  const distinct = byRaw.filter((p, i) => i === 0 || p.rawCm - byRaw[i - 1].rawCm > 0.2);
  if (distinct.length < 2) return null;
  const interp = pchip(
    distinct.map((p) => p.rawCm),
    distinct.map((p) => p.litres),
  );
  const lo = distinct[0].rawCm;
  const hi = distinct[distinct.length - 1].rawCm;
  return {
    kind: 'interp',
    offsetCm: 0,
    offsetSigmaCm: 0.3,
    calibrated: true,
    rangeCm: [lo - 1, hi + 1],
    predict: (raw) => ({ litres: Math.max(0, interp(raw)), depthCm: null }),
    slope: (raw) => Math.abs(interp(raw + 0.25) - interp(raw - 0.25)) / 0.5,
  };
}

export interface EchoLevelEstimate {
  litres: number;
  depthCm: number | null;
  distanceCm: number;
  uncertaintyLitres: number;
  confidence: number;
  inRange: boolean;
}

/**
 * Litres from one echo measurement. ± = |dV/dd| · (echo spread + 1 mm resolution floor +
 * offset σ). Confidence multiplies the echo's own confidence by calibration factors.
 */
export function estimateLitresFromEcho(
  fit: EchoLevelFit,
  echo: { rawCm: number; spreadCm: number; confidence: number },
  capacityLitres?: number,
): EchoLevelEstimate {
  const { litres: l, depthCm } = fit.predict(echo.rawCm);
  const cap = capacityLitres ?? Infinity;
  const litres = clamp(l, 0, cap);
  const sigmaCm = echo.spreadCm + 0.1 + fit.offsetSigmaCm;
  const uncertaintyLitres = fit.slope(echo.rawCm) * sigmaCm;
  const inRange = echo.rawCm >= fit.rangeCm[0] && echo.rawCm <= fit.rangeCm[1] && l <= cap;
  let confidence = echo.confidence;
  confidence *= fit.calibrated ? 1 : 0.6;
  confidence *= inRange ? 1 : 0.6;
  return {
    litres,
    depthCm,
    distanceCm: echo.rawCm + fit.offsetCm,
    uncertaintyLitres,
    confidence: clamp(confidence, 0, 1),
    inRange,
  };
}
