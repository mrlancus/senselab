/// <reference lib="webworker" />
import { handlers, type DspRequest } from './dsp-handlers';

// Heavy DSP runs here so the UI stays responsive while we crunch a recording.
self.onmessage = (e: MessageEvent<DspRequest>) => {
  const { id, fn, args } = e.data;
  try {
    const result = (handlers[fn] as (...a: unknown[]) => unknown)(...args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
