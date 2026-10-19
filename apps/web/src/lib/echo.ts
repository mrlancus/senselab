import type { ChirpBand, EchoConfig } from '@senselab/dsp';
import { loadAudioProfile } from './profile';

/**
 * Per-device echo settings: the chirp band (from the sensor check), the free-air reference
 * for that band, and the air temperature used for the speed of sound.
 */

/** Response window kept for every echo measurement, cm. Fixed so references stay comparable. */
export const ECHO_WINDOW_CM = 150;

/** Used when the sensor check hasn't run: audible, but works on every phone. */
const FALLBACK: ChirpBand = { f0: 2000, f1: 8000, kind: 'audible' };

export function echoBand(sampleRate: number): { band: ChirpBand; fromProfile: boolean } {
  const p = loadAudioProfile();
  const chirp = p?.chirp;
  // A profile from another sample rate (e.g. headphones) may not fit under Nyquist.
  if (chirp && Math.max(chirp.f0, chirp.f1) <= 0.46 * sampleRate) {
    return { band: chirp, fromProfile: true };
  }
  return { band: FALLBACK, fromProfile: false };
}

export function echoConfig(sampleRate: number): EchoConfig & { kind: ChirpBand['kind'] } {
  const { band } = echoBand(sampleRate);
  return { sampleRate, f0: band.f0, f1: band.f1, kind: band.kind };
}

const refKey = (c: EchoConfig) => `senselab.echoRef.${c.sampleRate}.${c.f0}.${c.f1}`;

export interface StoredReference {
  corr: number[];
  measuredAt: string;
}

export function loadReference(c: EchoConfig): Float64Array | null {
  try {
    const raw = localStorage.getItem(refKey(c));
    if (!raw) return null;
    return Float64Array.from((JSON.parse(raw) as StoredReference).corr);
  } catch {
    return null;
  }
}

export function saveReference(c: EchoConfig, corr: Float64Array) {
  try {
    const v: StoredReference = { corr: Array.from(corr), measuredAt: new Date().toISOString() };
    localStorage.setItem(refKey(c), JSON.stringify(v));
  } catch {
    /* private mode: the reference lasts this session only */
  }
}

export function clearReference(c: EchoConfig) {
  try {
    localStorage.removeItem(refKey(c));
  } catch {
    /* ignore */
  }
}

const TEMP_KEY = 'senselab.airTempC';

export function loadAirTemp(): number {
  try {
    const v = parseFloat(localStorage.getItem(TEMP_KEY) ?? '');
    return Number.isFinite(v) ? v : 20;
  } catch {
    return 20;
  }
}

export function saveAirTemp(t: number) {
  try {
    localStorage.setItem(TEMP_KEY, String(t));
  } catch {
    /* ignore */
  }
}
