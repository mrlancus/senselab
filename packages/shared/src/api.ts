/**
 * Anonymous identity: a random ID generated on first launch and kept in localStorage.
 * Every API request carries it in this header. When real auth arrives, the server-side
 * middleware that reads it is the single place to swap in a user ID.
 */
export const DEVICE_ID_HEADER = 'X-Device-Id';

/** Device IDs are UUIDs; anything else is rejected. */
export const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recording uploads are capped so a mistaken upload can't run up R2 storage. */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

export const recordingModes = ['tap', 'echo', 'camera', 'sensor-check', 'knock', 'other'] as const;
export type RecordingMode = (typeof recordingModes)[number];

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  ok: true;
  service: 'senselab';
  version: string;
}
