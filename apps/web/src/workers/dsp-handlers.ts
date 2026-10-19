import {
  ampToDb,
  analyzeEcho,
  analyzeRoom,
  analyzeSweep,
  analyzeTaps,
  crossCorrelate,
  echoResponse,
  envelope,
  magnitudeSpectrum,
  makeEchoTrain,
  speedOfSound,
  spectrogram,
  summarizeTaps,
  type EchoAnalysisOptions,
  type EchoConfig,
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
  analyzeTaps: (x: Float32Array, sampleRate: number, band: [number, number] = [80, 6000]) => {
    const { taps, onsetsS } = analyzeTaps(x, sampleRate, { fMin: band[0], fMax: band[1] });
    const summary = summarizeTaps(taps);
    // Debug: the in-band spectrum of the first few taps.
    const spectra = taps.slice(0, 4).map((t) => {
      const start = Math.round(t.onsetS * sampleRate) + Math.round(0.003 * sampleRate);
      const seg = x.slice(start, start + Math.round(0.12 * sampleRate));
      const s = magnitudeSpectrum(seg, sampleRate, { zeroPad: 4 });
      const k0 = Math.floor(band[0] / s.binHz);
      const k1 = Math.ceil(band[1] / s.binHz);
      return {
        f0: k0 * s.binHz,
        dHz: s.binHz,
        db: Float32Array.from(s.mags.subarray(k0, k1), (m) => ampToDb(m)),
        peakHz: t.frequency,
      };
    });
    return { taps, onsetsS, summary, spectra };
  },
  echo: (
    recorded: Float32Array,
    emitIndex: number,
    cfg: EchoConfig,
    windowCm: number,
    opts: Omit<EchoAnalysisOptions, 'speed'> & { tempC?: number } = {},
  ) => {
    const train = makeEchoTrain(cfg);
    const speed = speedOfSound(opts.tempC ?? 20);
    const resp = echoResponse(recorded, train, { emitIndex, maxCm: windowCm });
    const analysis = analyzeEcho(resp, train, { ...opts, speed });
    return {
      analysis,
      corr: resp.corr,
      pre: resp.pre,
      directAbs: resp.directAbs,
      repeatsUsed: resp.perRepeat.length,
      speed,
      samplesPerCm: (2 * cfg.sampleRate) / (100 * speed),
    };
  },
  analyzeRoom: (x: Float32Array, sampleRate: number) => analyzeRoom(x, sampleRate),
};

export type Handlers = typeof handlers;
export type DspRequest = {
  [K in keyof Handlers]: { id: number; fn: K; args: Parameters<Handlers[K]> };
}[keyof Handlers];
