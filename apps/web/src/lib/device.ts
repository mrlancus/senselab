const KEY = 'senselab.deviceId';

/**
 * Anonymous per-install identity. Kept in localStorage; if storage is unavailable (private
 * mode) we fall back to a per-session ID so the app still works, just without persistence.
 */
let cached: string | null = null;
export function deviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = crypto.randomUUID();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached = crypto.randomUUID();
  }
  return cached;
}
