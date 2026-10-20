import type { ChirpBand, SweepAnalysis } from '@senselab/dsp';

/** Per-device audio capabilities measured by the sensor check, kept in localStorage. */
export interface AudioProfile {
  measuredAt: string;
  sampleRate: number;
  latencyS: number;
  usableMaxHz: number;
  chirp: ChirpBand | null;
  bands: SweepAnalysis['bands'];
  userAgent: string;
}

const KEY = 'senselab.audioProfile';

export function loadAudioProfile(): AudioProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AudioProfile) : null;
  } catch {
    return null;
  }
}

export function saveAudioProfile(p: AudioProfile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: profile lasts this session only */
  }
}
