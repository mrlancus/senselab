// AudioWorklet that forwards mic samples to the main thread in ~43 ms batches.
// Runs on the audio rendering thread, so it must stay tiny.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;
/** AudioContext frame index of the current render quantum's first sample. */
declare const currentFrame: number | undefined;

const BATCH = 2048;

class RecorderProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(BATCH);
  private fill = 0;
  /**
   * AudioContext frame of buf[0], so the main thread can line recordings up with
   * `AudioBufferSourceNode.start(when)` exactly. Falls back to a sample count since the
   * processor started if the browser lacks `currentFrame`.
   */
  private frame = 0;
  private counted = 0;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const base = typeof currentFrame === 'number' ? currentFrame : this.counted;
    this.counted += ch.length;
    let i = 0;
    while (i < ch.length) {
      if (this.fill === 0) this.frame = base + i;
      const n = Math.min(ch.length - i, BATCH - this.fill);
      this.buf.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === BATCH) {
        this.port.postMessage({ frame: this.frame, samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(BATCH);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('senselab-recorder', RecorderProcessor);
export {};
