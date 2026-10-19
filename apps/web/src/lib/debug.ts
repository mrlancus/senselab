import { useSyncExternalStore } from 'react';

const KEY = 'senselab.debug';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let enabled = read();

export function setDebug(on: boolean) {
  enabled = on;
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

/** Debug views are hidden unless enabled with ?debug=1 or five taps on the footer. */
export function useDebug(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
  );
}
