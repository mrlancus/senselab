import { analytic, crossCorrelate } from './correlate';
import { fft, nextPow2 } from './fft';
import { median } from './stats';

/**
 * Presence: is something moving near the phone, and is someone breathing?
 *
 * The phone pings continuously (a short near-ultrasonic chirp every 50 ms). Each ping's
 * matched-filter output is a complex "range profile": one value per distance bin. Walls and
 * furniture give the same profile every ping, so subtracting the running average leaves
 * only what changed:
 * - **Motion:** the energy of that change over 20–200 cm, relative to the static profile.
 * - **Breathing:** a chest moving a few mm changes the echo's *phase* (Δφ = 4π·Δd/λ, about
 *   0.7 rad per mm at 19 kHz). Over a 30 s window, the bin whose complex value oscillates
 *   most strongly in 0.1–0.7 Hz (6–42 breaths/min) gives the rate.
 */

export interface PingFrames {
  /** frames[k] = complex range profile of ping k: interleaved [re0, im0, re1, im1, …]. */
  frames: Float32Array[];
  /** Samples per range bin step (1 sample). Bin 0 is `pre` samples before the direct path. */
  pre: number;
  bins: number;
}

/**
 * Range profiles for every whole ping in `x`. `first` is the index in `x` of a ping's direct
 * path (from the start-up alignment); pings repeat every `period` samples.
 */
export function pingFrames(
  x: ArrayLike<number>,
  template: ArrayLike<number>,
  first: number,
  period: number,
  bins: number,
  pre = 48,
): PingFrames {
  const r = crossCorrelate(x, template);
  const a = analytic(r);
  const frames: Float32Array[] = [];
  for (let s = first - pre; s + bins <= r.length; s += period) {
    if (s < 0) continue;
    const f = new Float32Array(bins * 2);
    for (let i = 0; i < bins; i++) {
      f[2 * i] = a.re[s + i];
      f[2 * i + 1] = a.im[s + i];
    }
    frames.push(f);
  }
  return { frames, pre, bins };
}

/** Mean complex profile (the static scene). */
export function meanProfile(frames: Float32Array[]): Float64Array {
  const n = frames[0]?.length ?? 0;
  const m = new Float64Array(n);
  for (const f of frames) for (let i = 0; i < n; i++) m[i] += f[i] / frames.length;
  return m;
}

/**
 * Motion index of one profile against the static background over bins [from, to):
 * changed energy over static energy. ~0 when nothing moves; a person walking past is ≫ 0.01.
 */
export function motionIndex(
  frame: Float32Array,
  background: Float64Array,
  from: number,
  to: number,
): number {
  let d = 0;
  let s = 0;
  const end = Math.min(to, frame.length / 2, background.length / 2);
  for (let i = Math.max(0, from); i < end; i++) {
    const dr = frame[2 * i] - background[2 * i];
    const di = frame[2 * i + 1] - background[2 * i + 1];
    d += dr * dr + di * di;
    s += background[2 * i] ** 2 + background[2 * i + 1] ** 2;
  }
  return s > 0 ? d / s : 0;
}

export interface Breathing {
  /** Breaths per minute. */
  bpm: number;
  /** Peak over the median of the 0.1–0.7 Hz band, dB. ≥ 10 dB is a clear rhythm. */
  snrDb: number;
  /** Range bin of the strongest breathing echo (good to ~±10 cm). */
  bin: number;
}

/**
 * Breathing rate from ≥ ~20 s of profiles at `frameHz`. Each bin's complex series (minus its
 * mean) is projected onto its main axis (PCA), giving a real signal whatever the echo's
 * phase. Its spectrum in 0.1–0.7 Hz is searched for a peak; the bin that oscillates most
 * strongly there wins, and its peak-over-median is the confidence.
 */
export function breathingRate(
  frames: Float32Array[],
  frameHz: number,
  binFrom: number,
  binTo: number,
): Breathing | null {
  const n = frames.length;
  if (n < frameHz * 15) return null;
  const N = nextPow2(n * 4);
  const df = frameHz / N;
  const k0 = Math.ceil(0.1 / df);
  const k1 = Math.floor(0.7 / df);
  let best: (Breathing & { power: number }) | null = null;
  const end = Math.min(binTo, (frames[0].length >> 1) - 1);
  for (let b = Math.max(0, binFrom); b < end; b++) {
    let mr = 0;
    let mi = 0;
    for (const f of frames) {
      mr += f[2 * b];
      mi += f[2 * b + 1];
    }
    mr /= n;
    mi /= n;
    // 2×2 covariance → principal axis.
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const f of frames) {
      const x = f[2 * b] - mr;
      const y = f[2 * b + 1] - mi;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let k = 0; k < n; k++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)); // Hann
      re[k] = w * ((frames[k][2 * b] - mr) * c + (frames[k][2 * b + 1] - mi) * s);
    }
    fft(re, im);
    const p: number[] = [];
    let pk = k0;
    for (let k = k0; k <= k1; k++) {
      const v = re[k] * re[k] + im[k] * im[k];
      p.push(v);
      if (v > re[pk] * re[pk] + im[pk] * im[pk]) pk = k;
    }
    const peak = re[pk] * re[pk] + im[pk] * im[pk];
    const snrDb = 10 * Math.log10((peak + 1e-30) / (median(p) + 1e-30));
    // The bin that oscillates most strongly at its breathing peak is the chest.
    if (!best || peak > best.power) {
      best = {
        bpm: pk * df * 60,
        snrDb,
        bin: b,
        power: peak,
      };
    }
  }
  if (!best) return null;
  const { power: _power, ...out } = best;
  return out;
}
