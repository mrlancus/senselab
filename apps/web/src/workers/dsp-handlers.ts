import {
  analyzeSweep,
  crossCorrelate,
  envelope,
  spectrogram,
  type SweepAnalysisInput,
} from '@senselab/dsp';

/** Functions callable in the DSP worker. Arguments and results must be structured-cloneable. */
export const handlers = {
  analyzeSweep: (input: SweepAnalysisInput) => {
    const analysis = analyzeSweep(input);
    // Correlation envelope around the detected sweep, for the debug plot.
    const maxLag = Math.min(input.recorded.length - 1, Math.round(input.sweep.sampleRate * 0.6));
    const corr = envelope(crossCorrelate(input.recorded, input.emitted, maxLag));
    return { analysis, correlation: Float32Array.from(corr) };
  },
  spectrogram: (x: Float32Array, sampleRate: number, frameSize = 1024, hop = 512) =>
    spectrogram(x, sampleRate, { frameSize, hop }),
};

export type Handlers = typeof handlers;
export type DspRequest = {
  [K in keyof Handlers]: { id: number; fn: K; args: Parameters<Handlers[K]> };
}[keyof Handlers];
