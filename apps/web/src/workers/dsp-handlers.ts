import {
  ampToDb,
  analyzeEcho,
  breathingRate,
  pingFrames,
  bandSpectrogram,
  detectAlarm,
  makeFingerprint,
  matchFingerprint,
  type Fingerprint,
  analyzeRoom,
  analyzeSweep,
  analyzeTaps,
  crossCorrelate,
  detectOnsets,
  estimateResonance,
  knockFeatures,
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
  /** Every knock in a recording: its onset, features, and (debug) its band levels. */
  knocks: (x: Float32Array, sampleRate: number, imuPeaks: (number | null)[] = []) => {
    const onsets = detectOnsets(x, sampleRate, { minGapS: 0.25 });
    return onsets.map((o, i) => {
      const end = Math.min(
        x.length,
        onsets[i + 1]?.sample ?? x.length,
        o.sample + Math.round(0.3 * sampleRate),
      );
      return {
        onsetS: o.time,
        features: knockFeatures(x.subarray(o.sample, end), sampleRate, imuPeaks[i] ?? null),
      };
    });
  },
  /** Sound alerts: smoke/CO pattern plus every taught sound's best match in the window. */
  alertsScan: (
    x: Float32Array,
    sampleRate: number,
    templates: { label: string; fp: Fingerprint }[],
  ) => {
    const live = bandSpectrogram(x, sampleRate);
    return {
      alarm: detectAlarm(x, sampleRate),
      matches: templates.map((t) => ({ label: t.label, ...matchFingerprint(live, t.fp) })),
    };
  },
  makeFingerprint: (x: Float32Array, sampleRate: number) => makeFingerprint(x, sampleRate),
  /**
   * Presence: index in `x` of a ping's direct path. Every whole ping's direct path is equally
   * strong, and a chirp cut off at the window edge is weaker, so the global maximum is safe.
   */
  presenceAlign: (x: Float32Array, template: Float32Array) => {
    const env = envelope(crossCorrelate(x, template, x.length - template.length));
    let best = -1;
    let max = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > max) [max, best] = [env[i], i];
    return best;
  },
  /**
   * Range profiles for every whole ping in `x`, and where each one's direct path peaks (bin);
   * a jump away from `pre` means the audio stream glitched and the caller must re-align.
   */
  presenceFrames: (
    x: Float32Array,
    template: Float32Array,
    first: number,
    period: number,
    bins: number,
    pre: number,
  ) => {
    const frames = pingFrames(x, template, first, period, bins, pre).frames;
    const directBins = frames.map((f) => {
      let best = 0;
      let bi = 0;
      for (let i = 0; i < Math.min(bins, 2 * pre); i++) {
        const m = f[2 * i] ** 2 + f[2 * i + 1] ** 2;
        if (m > best) [best, bi] = [m, i];
      }
      return bi;
    });
    return { frames, directBins };
  },
  breathing: (frames: Float32Array[], frameHz: number, binFrom: number, binTo: number) =>
    breathingRate(frames, frameHz, binFrom, binTo),
  /** Fruit: the first strong resonance of each tap, 60–1500 Hz. */
  fruitTaps: (x: Float32Array, sampleRate: number) => {
    const onsets = detectOnsets(x, sampleRate, { minGapS: 0.25 });
    return onsets
      .map((o) => {
        const r = estimateResonance(
          x.subarray(o.sample, Math.min(x.length, o.sample + Math.round(0.25 * sampleRate))),
          sampleRate,
          {
            fMin: 60,
            fMax: 1500,
            windowS: 0.2,
          },
        );
        return r && r.snrDb > 10
          ? { onsetS: o.time, frequency: r.frequency, snrDb: r.snrDb, q: r.q }
          : null;
      })
      .filter((v): v is NonNullable<typeof v> => v != null);
  },
};

export type Handlers = typeof handlers;
export type DspRequest = {
  [K in keyof Handlers]: { id: number; fn: K; args: Parameters<Handlers[K]> };
}[keyof Handlers];
