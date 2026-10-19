import { describe, expect, it } from 'vitest';
import {
  analyzeEcho,
  echoResponse,
  fractionalShift,
  makeEchoTrain,
  noReferenceMinCm,
  speedOfSound,
  temperatureForSpeed,
  type EchoTrain,
} from '../src';
import { addNoise, fractionalDelay, SR } from './synth';

const C = speedOfSound(20);

/**
 * A phone's view of its own chirp train. The speaker colours every path the same way
 * (a little ringing: paths at 0, 3.2 and 7.9 samples), then the sound reaches the mic
 * directly and via reflections at given one-way distances. `nearField` adds paths that
 * only the direct sound takes (the phone body), and `latency` is the round-trip latency.
 */
function simulate(
  train: EchoTrain,
  opts: {
    echoes?: { cm: number; gain: number }[];
    nearField?: { cm: number; gain: number }[];
    latency?: number;
    noise?: number;
    seed?: number;
    pad?: number;
  } = {},
) {
  const pad = opts.pad ?? 4800;
  const len = pad + train.train.length + 9600;
  const t0 = pad + (opts.latency ?? 2000.3);
  const speaker = [
    { delay: 0, gain: 1 },
    { delay: 3.2, gain: -0.45 },
    { delay: 7.9, gain: 0.2 },
  ];
  const toDelay = (cm: number) => (2 * (cm / 100) * SR) / C;
  const paths = [
    { delay: 0, gain: 1 },
    ...(opts.nearField ?? []).map((e) => ({ delay: toDelay(e.cm), gain: e.gain })),
    ...(opts.echoes ?? []).map((e) => ({ delay: toDelay(e.cm), gain: e.gain })),
  ];
  const out = new Float64Array(len);
  for (const p of paths) {
    for (const s of speaker) {
      const d = fractionalDelay(train.train, t0 + p.delay + s.delay, len);
      for (let i = 0; i < len; i++) out[i] += p.gain * s.gain * d[i];
    }
  }
  return { recorded: addNoise(out, opts.noise ?? 0.01, opts.seed ?? 3), emitIndex: pad };
}

const ultra = makeEchoTrain({ sampleRate: SR, f0: 17000, f1: 21000 });

describe('speed of sound', () => {
  it('matches the textbook values and inverts', () => {
    expect(speedOfSound(0)).toBeCloseTo(331.3, 6);
    expect(speedOfSound(20)).toBeCloseTo(343.2, 1);
    expect(temperatureForSpeed(speedOfSound(27.5))).toBeCloseTo(27.5, 9);
  });
});

describe('echo train', () => {
  it('repeats the chirp at an exact sample period', () => {
    expect(ultra.period).toBe(4800);
    expect(ultra.train.length).toBe(4800 * 12);
    expect(ultra.train[ultra.period + 100]).toBe(ultra.chirp[100]);
    expect(() => makeEchoTrain({ sampleRate: SR, f0: 17e3, f1: 21e3, periodS: 0.005 })).toThrow();
  });

  it('fractionalShift is exact for band-limited signals', () => {
    const x = ultra.chirp;
    const padded = new Float64Array(2048);
    padded.set(x, 200);
    const shifted = fractionalShift(padded, 10.37);
    const expected = fractionalDelay(x, 210.37, 2048);
    let err = 0;
    for (let i = 0; i < 2048; i++) err = Math.max(err, Math.abs(shifted[i] - expected[i]));
    expect(err).toBeLessThan(1e-3);
  });
});

describe('echo ranging', () => {
  it('measures surfaces 8–60 cm away to within 2 mm (with a free-air reference)', () => {
    const ref = simulate(ultra, { seed: 99 });
    const reference = echoResponse(ref.recorded, ultra, { emitIndex: ref.emitIndex }).corr;
    for (const cm of [8, 10, 18, 40, 60]) {
      const { recorded, emitIndex } = simulate(ultra, { echoes: [{ cm, gain: 0.1 }], seed: cm });
      const a = analyzeEcho(echoResponse(recorded, ultra, { emitIndex }), ultra, { reference });
      // 8 cm is close to the resolution limit (~7 cm for 4 kHz): allow 3 mm there.
      expect(Math.abs(a.distanceCm! - cm), `${cm} cm`).toBeLessThan(cm < 10 ? 0.3 : 0.2);
    }
  });

  it('measures a water surface 25 cm away, with level, confidence and spread', () => {
    const { recorded, emitIndex } = simulate(ultra, { echoes: [{ cm: 25, gain: 0.12 }] });
    const resp = echoResponse(recorded, ultra, { emitIndex });
    expect(resp.perRepeat).toHaveLength(12);
    expect(resp.directAbs - emitIndex).toBeGreaterThan(1990);
    expect(resp.directAbs - emitIndex).toBeLessThan(2010);
    const a = analyzeEcho(resp, ultra);
    expect(a.best).not.toBeNull();
    expect(Math.abs(a.distanceCm! - 25)).toBeLessThan(0.1);
    expect(a.best!.levelDb).toBeCloseTo(20 * Math.log10(0.12), 0);
    expect(a.confidence).toBeGreaterThan(0.6);
    expect(a.spreadCm).toBeLessThan(0.1);
  });

  it('works with an audible band and a large latency (over one chirp period)', () => {
    const audible = makeEchoTrain({ sampleRate: SR, f0: 2000, f1: 8000 });
    const { recorded, emitIndex } = simulate(audible, {
      echoes: [{ cm: 12, gain: 0.2 }],
      latency: 13000.6,
    });
    const ref = simulate(audible, { latency: 13000.6, seed: 12 });
    const reference = echoResponse(ref.recorded, audible, { emitIndex: ref.emitIndex }).corr;
    const a = analyzeEcho(echoResponse(recorded, audible, { emitIndex }), audible, { reference });
    expect(Math.abs(a.distanceCm! - 12)).toBeLessThan(0.2);
  });

  it('applies the calibrated offset', () => {
    const { recorded, emitIndex } = simulate(ultra, { echoes: [{ cm: 18, gain: 0.1 }] });
    const a = analyzeEcho(echoResponse(recorded, ultra, { emitIndex }), ultra, { offsetCm: 1.5 });
    expect(a.distanceCm! - a.best!.rawCm).toBeCloseTo(1.5, 9);
  });

  it('reports nothing when there is no echo, with or without a reference', () => {
    const ref = simulate(ultra, { seed: 41 });
    const reference = echoResponse(ref.recorded, ultra, { emitIndex: ref.emitIndex }).corr;
    const { recorded, emitIndex } = simulate(ultra, { echoes: [] });
    const resp = echoResponse(recorded, ultra, { emitIndex });
    for (const a of [analyzeEcho(resp, ultra), analyzeEcho(resp, ultra, { reference })]) {
      expect(a.best).toBeNull();
      expect(a.distanceCm).toBeNull();
      expect(a.confidence).toBe(0);
    }
  });

  it('without a reference, blanks the first ~17 cm (ultrasonic) but still measures beyond', () => {
    expect(noReferenceMinCm(ultra)).toBeGreaterThan(15);
    expect(noReferenceMinCm(ultra)).toBeLessThan(19);
    const { recorded, emitIndex } = simulate(ultra, { echoes: [{ cm: 30, gain: 0.1 }] });
    const a = analyzeEcho(echoResponse(recorded, ultra, { emitIndex }), ultra);
    expect(a.usedReference).toBe(false);
    expect(Math.abs(a.distanceCm! - 30)).toBeLessThan(0.3);
  });

  it('a free-air reference uncovers a weak, close echo hidden in the direct-path ringing', () => {
    // Reflections off the phone's own body, 2–5 cm: they hide anything that close.
    const nearField = [
      { cm: 2.2, gain: 0.5 },
      { cm: 3.1, gain: -0.35 },
      { cm: 4.4, gain: 0.25 },
    ];
    const ref = simulate(ultra, { nearField, seed: 7, noise: 0.002 });
    const meas = simulate(ultra, {
      nearField,
      echoes: [{ cm: 9, gain: 0.04 }],
      seed: 8,
      noise: 0.002,
    });
    const refResp = echoResponse(ref.recorded, ultra, { emitIndex: ref.emitIndex });
    const resp = echoResponse(meas.recorded, ultra, { emitIndex: meas.emitIndex });

    const without = analyzeEcho(resp, ultra);
    const withRef = analyzeEcho(resp, ultra, { reference: refResp.corr });
    expect(withRef.usedReference).toBe(true);
    expect(Math.abs(withRef.distanceCm! - 9)).toBeLessThan(0.3);
    // Without the reference the ringing wins (or the answer is far off).
    expect(without.distanceCm == null || Math.abs(without.distanceCm - 9) > 0.5).toBe(true);
  });

  it('prefers the expected echo when two are similar, and flags the ambiguity', () => {
    const { recorded, emitIndex } = simulate(ultra, {
      echoes: [
        { cm: 15, gain: 0.1 },
        { cm: 32, gain: 0.09 },
      ],
    });
    const resp = echoResponse(recorded, ultra, { emitIndex });
    const ref = simulate(ultra, { seed: 77 });
    const reference = echoResponse(ref.recorded, ultra, { emitIndex: ref.emitIndex }).corr;
    const strongest = analyzeEcho(resp, ultra, { reference });
    expect(Math.abs(strongest.distanceCm! - 15)).toBeLessThan(0.3);
    expect(strongest.runnerUpDb).toBeGreaterThan(-3);
    expect(strongest.confidence).toBeLessThan(0.6);
    const expected = analyzeEcho(resp, ultra, { reference, expectRawCm: 30 });
    expect(Math.abs(expected.distanceCm! - 32)).toBeLessThan(0.3);
  });

  it('throws when the recording is too short', () => {
    expect(() => echoResponse(new Float64Array(1000), ultra)).toThrow(/too short/);
  });
});
