// AudioWorklet that forwards mic samples to the main thread in ~43 ms batches.
// Runs on the audio rendering thread, so it must stay tiny.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;

const BATCH = 2048;

class RecorderProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(BATCH);
  private fill = 0;
  /** Index (in samples, since the processor started) of buf[0]. */
  private frame = 0;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, BATCH - this.fill);
      this.buf.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === BATCH) {
        this.port.postMessage({ frame: this.frame, samples: this.buf }, [this.buf.buffer]);
        this.frame += BATCH;
        this.buf = new Float32Array(BATCH);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('senselab-recorder', RecorderProcessor);
export {};
