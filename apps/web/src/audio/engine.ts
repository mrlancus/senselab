import workletUrl from './recorder.worklet.ts?worker&url';

/**
 * One AudioContext + one raw microphone stream for the whole app. Created lazily from a
 * user gesture (required on iOS). All voice processing is switched off and we read back
 * what the browser actually gave us.
 */

export interface MicInfo {
  sampleRate: number;
  /** What the track reports after our constraints (browsers may ignore some). */
  settings: MediaTrackSettings;
  label: string;
  baseLatencyS: number;
  outputLatencyS: number | null;
}

type Listener = (chunk: Float32Array) => void;

class AudioEngine {
  ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private listeners = new Set<Listener>();
  /** Samples recorded since the worklet started; maps to ctx time via `startFrameTime`. */
  framesSeen = 0;
  info: MicInfo | null = null;

  get running() {
    return !!this.node;
  }

  /** Must be called from a user gesture (tap) the first time. */
  async start(): Promise<MicInfo> {
    if (this.info && this.ctx?.state === 'running') return this.info;
    // iOS 17+: ask for a play-and-record session so speaker and mic work together.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = 'play-and-record';
      } catch {
        /* older Safari */
      }
    }
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.ctx.audioWorklet) throw new Error('AudioWorklet is not supported in this browser');

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    }
    if (!this.node) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'senselab-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.node.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) => {
        this.framesSeen = e.data.frame + e.data.samples.length;
        for (const l of this.listeners) l(e.data.samples);
      };
      // The worklet must be pulled by the graph to run; a muted gain keeps the mic silent.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      src.connect(this.node).connect(mute).connect(this.ctx.destination);
    }
    const track = this.stream.getAudioTracks()[0]!;
    this.info = {
      sampleRate: this.ctx.sampleRate,
      settings: track.getSettings(),
      label: track.label,
      baseLatencyS: this.ctx.baseLatency ?? 0,
      outputLatencyS: 'outputLatency' in this.ctx ? this.ctx.outputLatency : null,
    };
    return this.info;
  }

  onChunk(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Records for `seconds` and resolves with the samples. */
  record(seconds: number): Promise<Float32Array> {
    return this.capture((done) => setTimeout(done, seconds * 1000));
  }

  /**
   * Records while `during` runs: `during(done)` must call `done()` when capture can stop.
   * Returns everything recorded in between.
   */
  capture(during: (done: () => void) => void): Promise<Float32Array> {
    if (!this.ctx) throw new Error('Audio not started');
    const chunks: Float32Array[] = [];
    const off = this.onChunk((c) => chunks.push(c));
    return new Promise((resolve) => {
      during(() => {
        off();
        resolve(concat(chunks));
      });
    });
  }

  /** Plays samples through the speaker; resolves when playback ends. */
  play(samples: Float32Array, delayS = 0.05): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new Error('Audio not started');
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    return new Promise((resolve) => {
      node.onended = () => resolve();
      node.start(ctx.currentTime + delayS);
    });
  }

  /** Plays while recording, with `padS` of extra capture either side. */
  async playAndRecord(samples: Float32Array, padS = 0.3): Promise<Float32Array> {
    return this.capture((done) => {
      setTimeout(async () => {
        await this.play(samples);
        setTimeout(done, padS * 1000);
      }, padS * 1000);
    });
  }

  async stop() {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.info = null;
    await this.ctx?.suspend();
  }
}

export function concat(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export const audio = new AudioEngine();
