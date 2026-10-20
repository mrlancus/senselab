import { linearFit } from './fit';
import { mean } from './stats';

/**
 * Metal finder. Ferromagnetic things (iron, steel: screws, nails, rebar, pipes) bend the
 * Earth's magnetic field (25–65 µT) near them. Non-ferrous metals (aluminium, copper, gold)
 * don't, at least not to a phone's static magnetometer.
 *
 * Two ways in:
 * - **Field magnitude** (Generic Sensor `Magnetometer`, Android Chrome behind a flag):
 *   |B| − |B₀| in µT. The magnitude doesn't change when the phone rotates, so it's the
 *   clean signal.
 * - **Compass deflection** (everywhere with a compass, iOS included): the heading changes
 *   both when the phone turns and when metal bends the field, but the gyroscope only sees
 *   real turns. Anomaly = Δheading − k·∫yaw rate, with k (≈ ±1: axis and sign conventions
 *   differ by browser) fitted while the user turns the phone away from metal.
 */

export const fieldMagnitude = (x: number, y: number, z: number) => Math.hypot(x, y, z);

/** Unwraps a heading series in degrees so it doesn't jump at 0/360. */
export function unwrapDegrees(h: ArrayLike<number>): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < h.length; i++) {
    if (i > 0) {
      const d = h[i] + offset - out[i - 1];
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    out.push(h[i] + offset);
  }
  return out;
}

export interface CompassSample {
  /** Seconds. */
  t: number;
  /** Compass heading, degrees (any fixed convention). */
  heading: number;
  /** Rotation rate about the screen normal, degrees per second (any sign convention). */
  yawRate: number;
}

/** Integrated yaw (degrees) by the trapezoid rule. */
export function integrateYaw(s: CompassSample[]): number[] {
  const out = [0];
  for (let i = 1; i < s.length; i++) {
    out.push(out[i - 1] + ((s[i].yawRate + s[i - 1].yawRate) / 2) * (s[i].t - s[i - 1].t));
  }
  return out;
}

export interface CompassCalibration {
  /** Gyro-to-heading gain (≈ ±1). */
  k: number;
  /** Residual spread away from metal, degrees (1σ). */
  noiseDeg: number;
  /** How much the phone turned during calibration, degrees (needs ≳ 20° to fit k). */
  turnedDeg: number;
}

/**
 * Fits heading = k·∫yaw + c over a calibration window recorded away from metal. If the phone
 * hardly turned, k can't be fitted; k = 1 is assumed and `turnedDeg` says so.
 */
export function calibrateCompass(s: CompassSample[]): CompassCalibration {
  const h = unwrapDegrees(s.map((v) => v.heading));
  const yaw = integrateYaw(s);
  const turned = Math.max(...yaw) - Math.min(...yaw);
  let k = 1;
  if (turned >= 20 && s.length >= 10) {
    const f = linearFit(yaw, h);
    if (Math.abs(f.slope) > 0.5 && Math.abs(f.slope) < 2) k = f.slope;
  }
  const r = residual(h, yaw, k);
  const mu = mean(r);
  const noiseDeg = Math.max(
    0.5,
    Math.sqrt(r.reduce((a, v) => a + (v - mu) ** 2, 0) / Math.max(1, r.length - 1)),
  );
  return { k, noiseDeg, turnedDeg: turned };
}

function residual(h: number[], yaw: number[], k: number) {
  return h.map((v, i) => v - k * yaw[i]);
}

/**
 * Compass anomaly (degrees) for a live window: heading not explained by the gyro, relative
 * to the window's first `baselineN` samples. Gyro drift (≲ 1°/min on phones) is negligible
 * over a sweep of a few seconds; re-zero between sweeps.
 */
export function compassAnomaly(s: CompassSample[], k: number, baselineN = 10): number[] {
  if (!s.length) return [];
  const r = residual(unwrapDegrees(s.map((v) => v.heading)), integrateYaw(s), k);
  const b = mean(r.slice(0, Math.max(1, Math.min(baselineN, r.length))));
  return r.map((v) => v - b);
}

export interface Detection {
  /** 0..1 for the meter: 0 at the noise level, 1 at 10σ. */
  level: number;
  /** Signal over the noise, in σ. */
  sigmas: number;
  detected: boolean;
}

/** Turns an anomaly into a meter reading; "detected" at ≥ 4σ. */
export function detectAnomaly(anomaly: number, noise: number): Detection {
  const sigmas = Math.abs(anomaly) / Math.max(noise, 1e-9);
  return { level: Math.max(0, Math.min(1, (sigmas - 1) / 9)), sigmas, detected: sigmas >= 4 };
}

/** Baseline statistics of |B| (µT) recorded away from metal. */
export function fieldBaseline(magnitudes: ArrayLike<number>): { mean: number; noise: number } {
  const m = mean(magnitudes);
  let s = 0;
  for (let i = 0; i < magnitudes.length; i++) s += (magnitudes[i] - m) ** 2;
  return { mean: m, noise: Math.max(0.2, Math.sqrt(s / Math.max(1, magnitudes.length - 1))) };
}
