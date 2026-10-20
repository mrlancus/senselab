import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ECHO_OFFSET_CM,
  estimateLitresFromEcho,
  fitEchoLevel,
  frustumLevelForLitres,
  frustumLitresAtLevel,
} from '../src';

const bucket = { topDiameterCm: 28, bottomDiameterCm: 22, heightCm: 24 };
/** Raw echo distance the phone would measure, held `holdCm` above the rim. */
const rawFor = (litres: number, holdCm: number) =>
  bucket.heightCm - frustumLevelForLitres(bucket, litres) + holdCm - DEFAULT_ECHO_OFFSET_CM;
const echo = (rawCm: number) => ({ rawCm, spreadCm: 0.05, confidence: 0.9 });

describe('echo → litres', () => {
  it('uses the frustum, with the default offset when uncalibrated', () => {
    const fit = fitEchoLevel([], bucket)!;
    expect(fit.calibrated).toBe(false);
    const e = estimateLitresFromEcho(fit, echo(rawFor(7.5, 0)));
    expect(e.litres).toBeCloseTo(7.5, 6);
    expect(e.depthCm).toBeCloseTo(frustumLevelForLitres(bucket, 7.5), 6);
    // Default offset σ is 1.5 cm: ±(0.05 + 0.1 + 1.5) cm × area.
    const area = (Math.PI * (11 + (3 * e.depthCm!) / 24) ** 2) / 1000;
    expect(e.uncertaintyLitres).toBeCloseTo(1.65 * area, 6);
    expect(e.confidence).toBeCloseTo(0.9 * 0.6, 6);
  });

  it('an empty-bucket point calibrates the hand height', () => {
    const hold = 9.3;
    const fit = fitEchoLevel([{ litres: 0, rawCm: rawFor(0, hold) }], bucket)!;
    expect(fit.calibrated).toBe(true);
    expect(fit.offsetCm).toBeCloseTo(DEFAULT_ECHO_OFFSET_CM - hold, 6);
    for (const l of [0, 3, 7.5, 11]) {
      expect(estimateLitresFromEcho(fit, echo(rawFor(l, hold))).litres).toBeCloseTo(l, 6);
    }
    expect(estimateLitresFromEcho(fit, echo(rawFor(0, hold))).inRange).toBe(true);
    // 5 cm "below the bottom" is nonsense.
    expect(estimateLitresFromEcho(fit, echo(rawFor(0, hold) + 5)).inRange).toBe(false);
  });

  it('several points: median offset, spread becomes the offset σ', () => {
    const fit = fitEchoLevel(
      [
        { litres: 0, rawCm: rawFor(0, 10) },
        { litres: 5, rawCm: rawFor(5, 10.4) },
        { litres: 10, rawCm: rawFor(10, 9.8) },
      ],
      bucket,
    )!;
    expect(fit.offsetCm).toBeCloseTo(DEFAULT_ECHO_OFFSET_CM - 10, 6);
    expect(fit.offsetSigmaCm).toBeGreaterThan(0.2);
    expect(fit.offsetSigmaCm).toBeLessThan(0.7);
  });

  it('without dimensions, interpolates through ≥ 2 points', () => {
    expect(fitEchoLevel([{ litres: 0, rawCm: 30 }])).toBeNull();
    const pts = [0, 5, 10].map((l) => ({ litres: l, rawCm: rawFor(l, 8) }));
    const fit = fitEchoLevel(pts)!;
    expect(fit.kind).toBe('interp');
    const e = estimateLitresFromEcho(fit, echo(rawFor(7.5, 8)));
    expect(Math.abs(e.litres - 7.5)).toBeLessThan(0.15);
    expect(e.depthCm).toBeNull();
    expect(estimateLitresFromEcho(fit, echo(rawFor(0, 8) + 3)).inRange).toBe(false);
  });

  it('clamps to capacity', () => {
    const fit = fitEchoLevel([], bucket)!;
    const cap = frustumLitresAtLevel(bucket, bucket.heightCm);
    expect(estimateLitresFromEcho(fit, echo(-10), cap).litres).toBeCloseTo(cap, 6);
  });
});
