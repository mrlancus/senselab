import { chirp, type ChirpOptions } from './chirp';
import { findDelay } from './correlate';
import { bandPower, welchPsd } from './spectrum';
import { toDb } from './stats';

/**
 * Speaker → microphone frequency-response check. We play a log sweep, record it, and in
 * each frequency band compare the recorded power (while the sweep is in that band) with
 * the background noise. That tells us which frequencies this phone can actually emit and
 * hear, so echo ranging can pick its chirp band per device.
 */

export const DEFAULT_BAND_EDGES = [
  200, 500, 1000, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 15000, 16000, 17000, 18000, 19000,
  20000, 21000, 22000, 23000,
];

export function sweepOptions(sampleRate: number, durationS = 3): ChirpOptions {
  return {
    f0: 150,
    f1: Math.min(23000, 0.48 * sampleRate),
    durationS,
    sampleRate,
    method: 'log',
    fadeS: 0.01,
    amplitude: 0.7,
  };
}

export function makeSweep(sampleRate: number, durationS = 3): Float32Array {
  return chirp(sweepOptions(sampleRate, durationS));
}

export interface BandResult {
  fLo: number;
  fHi: number;
  /** Recorded/emitted power ratio, normalised so the best band is 0 dB. */
  responseDb: number;
  /** Recorded power while the sweep was in band, over background noise in band. */
  snrDb: number;
}

export interface ChirpBand {
  f0: number;
  f1: number;
  kind: 'ultrasonic' | 'audible';
}

export interface SweepAnalysis {
  /** Output-to-input latency, seconds (when the sweep starts in the recording). */
  latencyS: number;
  /** Normalised matched-filter score; below ~0.05 the sweep probably wasn't heard. */
  matchScore: number;
  heard: boolean;
  bands: BandResult[];
  /** Highest band edge with SNR ≥ 10 dB. */
  usableMaxHz: number;
  recommended: ChirpBand | null;
}

export interface SweepAnalysisInput {
  sweep: ChirpOptions;
  emitted: ArrayLike<number>;
  recorded: ArrayLike<number>;
  /** A recording of the room with nothing playing, same gain settings. */
  noise: ArrayLike<number>;
  bandEdges?: number[];
  /** SNR needed for a band to count as usable for chirps. Default 15 dB. */
  minSnrDb?: number;
}

const frameFor = (len: number) => {
  let n = 256;
  while (n * 2 <= len && n < 4096) n *= 2;
  return n;
};

export function analyzeSweep(input: SweepAnalysisInput): SweepAnalysis {
  const { sweep, emitted, recorded, noise } = input;
  const sr = sweep.sampleRate;
  const minSnr = input.minSnrDb ?? 15;
  const { lag, score } = findDelay(recorded, emitted, { useEnvelope: true });
  const start = Math.max(0, Math.round(lag));

  const edges = (input.bandEdges ?? DEFAULT_BAND_EDGES).filter(
    (f) => f >= Math.min(sweep.f0, sweep.f1) && f <= Math.max(sweep.f0, sweep.f1),
  );
  const k = sweep.f1 / sweep.f0;
  const timeOf = (f: number) => (sweep.durationS * Math.log(f / sweep.f0)) / Math.log(k);

  const raw: { fLo: number; fHi: number; ratio: number; snrDb: number }[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const fLo = edges[i];
    const fHi = edges[i + 1];
    const a = Math.floor(timeOf(fLo) * sr);
    const b = Math.ceil(timeOf(fHi) * sr);
    if (b - a < 64) continue;
    const frameSize = frameFor(b - a);
    const sliceOf = (x: ArrayLike<number>, from: number) =>
      Array.prototype.slice.call(x, from, Math.min(x.length, from + (b - a))) as number[];
    const rec = welchPsd(sliceOf(recorded, start + a), sr, { frameSize });
    const emit = welchPsd(sliceOf(emitted, a), sr, { frameSize });
    const bg = welchPsd(noise, sr, { frameSize });
    const pRec = bandPower(rec, fLo, fHi);
    const pEmit = bandPower(emit, fLo, fHi);
    const pBg = bandPower(bg, fLo, fHi);
    raw.push({
      fLo,
      fHi,
      ratio: pRec / Math.max(pEmit, 1e-20),
      snrDb: toDb(pRec / Math.max(pBg, 1e-20)),
    });
  }
  const best = Math.max(...raw.map((r) => r.ratio), 1e-20);
  const bands: BandResult[] = raw.map((r) => ({
    fLo: r.fLo,
    fHi: r.fHi,
    responseDb: toDb(r.ratio / best),
    snrDb: r.snrDb,
  }));

  const heard = score > 0.05;
  const usable = bands.filter((b) => b.snrDb >= 10);
  return {
    latencyS: lag / sr,
    matchScore: score,
    heard,
    bands,
    usableMaxHz: usable.length ? Math.max(...usable.map((b) => b.fHi)) : 0,
    recommended: heard ? pickChirpBand(bands, minSnr) : null,
  };
}

/** Widest contiguous run of good bands, preferring near-ultrasonic (≥16 kHz, ≥2 kHz wide). */
export function pickChirpBand(bands: BandResult[], minSnrDb = 15): ChirpBand | null {
  const runs = (lo: number, hi: number) => {
    const out: { f0: number; f1: number }[] = [];
    let cur: { f0: number; f1: number } | null = null;
    for (const b of bands) {
      const ok = b.fLo >= lo && b.fHi <= hi && b.snrDb >= minSnrDb;
      if (ok && cur && b.fLo === cur.f1) cur.f1 = b.fHi;
      else if (ok) out.push((cur = { f0: b.fLo, f1: b.fHi }));
      else cur = null;
    }
    return out.sort((a, b) => b.f1 - b.f0 - (a.f1 - a.f0));
  };
  const ultra = runs(16000, 24000)[0];
  if (ultra && ultra.f1 - ultra.f0 >= 2000) return { ...ultra, kind: 'ultrasonic' };
  const audible = runs(1000, 12000)[0];
  if (audible && audible.f1 - audible.f0 >= 2000) {
    // An audible chirp is clearly heard; keep it in the 2–8 kHz region where phones are best.
    return { f0: Math.max(audible.f0, 2000), f1: Math.min(audible.f1, 8000), kind: 'audible' };
  }
  return null;
}
