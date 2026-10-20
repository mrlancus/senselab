import { realFft } from './fft';
import { median } from './stats';
import { makeWindow } from './window';

/**
 * Sound alerts.
 *
 * 1. **Smoke and CO alarms** have standard temporal patterns, so they can be recognised
 *    without teaching:
 *    - smoke / fire, ISO 8201 "temporal-3" (T3): three 0.5 s beeps 0.5 s apart, then 1.5 s
 *      off, repeating;
 *    - carbon monoxide, "temporal-4" (T4, UL 2034): four 0.1 s beeps 0.1 s apart, then ~5 s
 *      off.
 *    The tone is usually 3–3.5 kHz (piezo), or 520 Hz in low-frequency sounders. We track a
 *    strongly tonal peak in 400–700 Hz or 2.5–4.5 kHz, turn it into on/off runs, and match
 *    the run lengths with ±35% tolerance.
 * 2. **Taught sounds** (doorbell, washer chime, oven timer): a log-band spectrogram
 *    fingerprint of an example, matched against the live audio by sliding normalised
 *    correlation, which ignores loudness.
 */

export interface ToneFrame {
  t: number;
  /** Strongest frequency in the alarm bands, Hz. */
  freq: number;
  /** Peak bin over the band's median bin, dB. */
  tonalDb: number;
  /** Peak level, dB (relative). */
  levelDb: number;
}

const ALARM_BANDS: [number, number][] = [
  [400, 700],
  [2500, 4500],
];

export function toneFrames(
  x: ArrayLike<number>,
  sampleRate: number,
  frame = 2048,
  hop = 256,
): ToneFrame[] {
  const w = makeWindow('hann', frame);
  const out: ToneFrame[] = [];
  const binHz = sampleRate / frame;
  for (let start = 0; start + frame <= x.length; start += hop) {
    const seg = new Float64Array(frame);
    for (let i = 0; i < frame; i++) seg[i] = x[start + i] * w[i];
    const { re, im } = realFft(seg, frame);
    let best = { freq: 0, tonalDb: -Infinity, levelDb: -200 };
    for (const [lo, hi] of ALARM_BANDS) {
      if (hi > sampleRate / 2) continue;
      const k0 = Math.ceil(lo / binHz);
      const k1 = Math.floor(hi / binHz);
      const p: number[] = [];
      let pk = k0;
      for (let k = k0; k <= k1; k++) {
        const v = re[k] * re[k] + im[k] * im[k];
        p.push(v);
        if (v > re[pk] * re[pk] + im[pk] * im[pk]) pk = k;
      }
      const peak = re[pk] * re[pk] + im[pk] * im[pk];
      const tonalDb = 10 * Math.log10((peak + 1e-20) / (median(p) + 1e-20));
      if (tonalDb > best.tonalDb)
        best = { freq: pk * binHz, tonalDb, levelDb: 10 * Math.log10(peak + 1e-20) };
    }
    out.push({ t: (start + frame / 2) / sampleRate, ...best });
  }
  return out;
}

export interface ToneRun {
  on: boolean;
  start: number;
  duration: number;
  freq: number;
}

/**
 * On/off runs of a steady tone. A frame is "on" when it's strongly tonal (≥ 20 dB over its
 * band's median), loud (within 25 dB of the loudest frame) and near the dominant alarm
 * frequency.
 */
export function toneRuns(frames: ToneFrame[], hopS: number): ToneRun[] {
  const loud = Math.max(...frames.map((f) => f.levelDb), -200);
  const cand = frames.filter((f) => f.tonalDb >= 20 && f.levelDb >= loud - 25);
  if (!cand.length)
    return [{ on: false, start: frames[0]?.t ?? 0, duration: frames.length * hopS, freq: 0 }];
  const f0 = median(cand.map((f) => f.freq));
  const isOn = (f: ToneFrame) =>
    f.tonalDb >= 20 && f.levelDb >= loud - 25 && Math.abs(f.freq - f0) <= 0.06 * f0;
  const runs: ToneRun[] = [];
  for (const f of frames) {
    const on = isOn(f);
    const last = runs[runs.length - 1];
    if (last && last.on === on) last.duration += hopS;
    else runs.push({ on, start: f.t - hopS / 2, duration: hopS, freq: on ? f0 : 0 });
  }
  // Bridge single-frame dropouts inside a beep and drop single-frame blips.
  return mergeShort(runs, hopS * 1.5);
}

function mergeShort(runs: ToneRun[], minS: number): ToneRun[] {
  const out: ToneRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r.duration < minS) {
      last.duration += r.duration;
    } else if (last && last.on === r.on) {
      last.duration += r.duration;
    } else out.push({ ...r });
  }
  return out;
}

export interface AlarmMatch {
  kind: 'smoke' | 'co';
  /** Matched beep cycles (at least 1 full group). */
  groups: number;
  freq: number;
}

const near = (v: number, target: number, tol = 0.35) => Math.abs(v - target) <= tol * target;

/** Finds T3 (smoke) or T4 (CO) groups in a sequence of on/off runs. */
export function matchAlarmPattern(runs: ToneRun[]): AlarmMatch | null {
  const patterns = [
    { kind: 'smoke' as const, beeps: 3, on: 0.5, off: 0.5, pause: 1.5 },
    { kind: 'co' as const, beeps: 4, on: 0.1, off: 0.1, pause: 5 },
  ];
  for (const p of patterns) {
    let groups = 0;
    for (let i = 0; i + 2 * p.beeps - 1 <= runs.length; i++) {
      let ok = true;
      for (let b = 0; b < p.beeps && ok; b++) {
        const on = runs[i + 2 * b];
        ok = on.on && near(on.duration, p.on, p.on < 0.2 ? 0.6 : 0.35);
        if (ok && b < p.beeps - 1) {
          const off = runs[i + 2 * b + 1];
          ok = !!off && !off.on && near(off.duration, p.off, p.off < 0.2 ? 0.6 : 0.35);
        }
      }
      // The group must be bounded by a long pause, so a longer series of equal beeps isn't
      // counted. A pause cut short by the start or end of the window counts as one.
      const beforeI = i - 1;
      const afterI = i + 2 * p.beeps - 1;
      const bounded = (j: number) => {
        const r = runs[j];
        return !r || (!r.on && (r.duration >= p.pause * 0.6 || j === 0 || j === runs.length - 1));
      };
      const before = beforeI;
      const after = afterI;
      if (ok && bounded(before) && bounded(after)) groups++;
    }
    if (groups >= 1) return { kind: p.kind, groups, freq: runs.find((r) => r.on)?.freq ?? 0 };
  }
  return null;
}

/** Smoke/CO alarm detector over a recording (needs ≥ one full group, ~4 s for smoke). */
export function detectAlarm(x: ArrayLike<number>, sampleRate: number): AlarmMatch | null {
  const hop = 256;
  // 2048-point frames: fine enough (23 Hz bins at 48 kHz) to see a 520 Hz tone as tonal.
  const frames = toneFrames(x, sampleRate, 2048, hop);
  if (!frames.length) return null;
  return matchAlarmPattern(toneRuns(frames, hop / sampleRate));
}

// --- Taught sounds -----------------------------------------------------------------------

export const FINGERPRINT_BANDS = 24;
export const FINGERPRINT_HOP_S = 0.032;

export interface Fingerprint {
  bands: number;
  hopS: number;
  /** frames[t][b]: log band energy (dB), per frame mean removed. */
  frames: number[][];
  /** Frame loudness (dB) before normalisation, for the "loud enough" check. */
  levels: number[];
}

/** Log-band spectrogram (24 bands, 200 Hz–8 kHz, 32 ms hop) with each frame's mean removed. */
export function bandSpectrogram(x: ArrayLike<number>, sampleRate: number): Fingerprint {
  const frame = 2048;
  const hop = Math.round(FINGERPRINT_HOP_S * sampleRate);
  const w = makeWindow('hann', frame);
  const binHz = sampleRate / frame;
  const fLo = 200;
  const fHi = Math.min(8000, 0.45 * sampleRate);
  const edges = Array.from(
    { length: FINGERPRINT_BANDS + 1 },
    (_, i) => fLo * Math.pow(fHi / fLo, i / FINGERPRINT_BANDS),
  );
  const frames: number[][] = [];
  const levels: number[] = [];
  for (let start = 0; start + frame <= x.length; start += hop) {
    const seg = new Float64Array(frame);
    for (let i = 0; i < frame; i++) seg[i] = x[start + i] * w[i];
    const { re, im } = realFft(seg, frame);
    const b: number[] = [];
    for (let i = 0; i < FINGERPRINT_BANDS; i++) {
      let s = 0;
      let c = 0;
      for (let k = Math.ceil(edges[i] / binHz); k * binHz < edges[i + 1]; k++) {
        s += re[k] * re[k] + im[k] * im[k];
        c++;
      }
      b.push(10 * Math.log10(s / Math.max(1, c) + 1e-20));
    }
    const mu = b.reduce((a, v) => a + v, 0) / b.length;
    levels.push(Math.max(...b));
    frames.push(b.map((v) => v - mu));
  }
  return { bands: FINGERPRINT_BANDS, hopS: FINGERPRINT_HOP_S, frames, levels };
}

/**
 * The fingerprint of a taught sound: its loudest single event (frames within 25 dB of the
 * loudest, gaps under 0.5 s bridged), at most 4 s, values rounded to 0.1 dB so it stores
 * compactly.
 */
export function makeFingerprint(x: ArrayLike<number>, sampleRate: number): Fingerprint | null {
  const sg = bandSpectrogram(x, sampleRate);
  if (!sg.frames.length) return null;
  const loud = Math.max(...sg.levels);
  // Nothing louder than about −75 dBFS: there's no sound to learn.
  if (loud < -20) return null;
  // Loud frames, grouped into events split by ≥ 0.5 s of quiet; keep the loudest event, so
  // a recording that caught the sound twice still learns just one.
  const isLoud = sg.levels.map((l) => l >= loud - 25);
  const gap = Math.round(0.5 / FINGERPRINT_HOP_S);
  const events: { from: number; to: number; energy: number }[] = [];
  let quiet = Infinity;
  isLoud.forEach((on, i) => {
    if (!on) {
      quiet++;
      return;
    }
    const cur = events[events.length - 1];
    if (cur && quiet < gap) {
      cur.to = i + 1;
      cur.energy += 10 ** (sg.levels[i] / 10);
    } else events.push({ from: i, to: i + 1, energy: 10 ** (sg.levels[i] / 10) });
    quiet = 0;
  });
  const ev = events.sort((a, b) => b.energy - a.energy)[0];
  if (!ev || ev.to - ev.from < 3) return null;
  const from = ev.from;
  const to = Math.min(ev.to, from + Math.round(4 / FINGERPRINT_HOP_S));
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    ...sg,
    frames: sg.frames.slice(from, to).map((f) => f.map(round)),
    levels: sg.levels.slice(from, to).map(round),
  };
}

/**
 * Best normalised correlation (−1..1) of the template against any position in `live`,
 * and where. Silent stretches of `live` (more than 30 dB under its loudest frame) can't
 * match.
 */
export function matchFingerprint(
  live: Fingerprint,
  template: Fingerprint,
): { score: number; atS: number } {
  const T = template.frames;
  const L = live.frames;
  if (!T.length || L.length < T.length) return { score: 0, atS: 0 };
  const flatT = T.flat();
  const muT = flatT.reduce((a, v) => a + v, 0) / flatT.length;
  const dT = flatT.map((v) => v - muT);
  const nT = Math.sqrt(dT.reduce((a, v) => a + v * v, 0)) || 1;
  const loud = Math.max(...live.levels);
  let best = { score: 0, atS: 0 };
  for (let s = 0; s + T.length <= L.length; s++) {
    let lvl = 0;
    for (let i = 0; i < T.length; i++) lvl = Math.max(lvl, live.levels[s + i] - loud + 100);
    if (lvl < 70) continue;
    let sum = 0;
    for (let i = 0; i < T.length; i++) for (let b = 0; b < T[i].length; b++) sum += L[s + i][b];
    const muL = sum / flatT.length;
    let num = 0;
    let nL = 0;
    let k = 0;
    for (let i = 0; i < T.length; i++) {
      for (let b = 0; b < T[i].length; b++) {
        const d = L[s + i][b] - muL;
        num += d * dT[k++];
        nL += d * d;
      }
    }
    const score = num / (Math.sqrt(nL) * nT || 1);
    if (score > best.score) best = { score, atS: s * live.hopS };
  }
  return best;
}
