import { describe, expect, it } from 'vitest';
import {
  classifyKnock,
  createRng,
  detectOnsets,
  firmnessIndex,
  knockFeatures,
  leaveOneOut,
  trainKnock,
  type KnockExample,
} from '../src';
import { SR } from './synth';

/**
 * Synthetic knocks on three materials:
 * - glass: a bright, long ring (2.2 kHz + 5.9 kHz, τ ≈ 120 ms)
 * - wood: a dull, short knock (330 Hz + 900 Hz, τ ≈ 15 ms) with some click
 * - cardboard: a thud, mostly low-passed noise, τ ≈ 6 ms
 */
function knock(kind: 'glass' | 'wood' | 'cardboard', seed: number, gain = 0.4) {
  const rng = createRng(seed);
  const n = Math.round(0.3 * SR);
  const x = new Float64Array(n);
  const j = 1 + 0.03 * rng.gaussian(); // object-to-object variation
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v: number;
    if (kind === 'glass') {
      v =
        Math.exp(-t / 0.12) * Math.sin(2 * Math.PI * 2200 * j * t) +
        0.4 * Math.exp(-t / 0.05) * Math.sin(2 * Math.PI * 5900 * j * t);
    } else if (kind === 'wood') {
      v =
        Math.exp(-t / 0.015) * Math.sin(2 * Math.PI * 330 * j * t) +
        0.5 * Math.exp(-t / 0.008) * Math.sin(2 * Math.PI * 900 * j * t);
      if (i < 30) v += 0.6 * rng.gaussian();
    } else {
      lp = 0.9 * lp + 0.1 * rng.gaussian();
      v = 4 * Math.exp(-t / 0.006) * lp;
    }
    x[i] = gain * v + 0.002 * rng.gaussian();
  }
  return x;
}

const kinds = ['glass', 'wood', 'cardboard'] as const;
const examples: KnockExample[] = kinds.flatMap((k, ki) =>
  [0, 1, 2, 3, 4].map((i) => ({ label: k, features: knockFeatures(knock(k, 10 * ki + i), SR) })),
);

describe('knock features', () => {
  it('capture brightness, pitch and ring-down', () => {
    const g = knockFeatures(knock('glass', 1), SR);
    const w = knockFeatures(knock('wood', 1), SR);
    const c = knockFeatures(knock('cardboard', 1), SR);
    expect(g.peakHz).toBeGreaterThan(2000);
    expect(g.peakHz).toBeLessThan(2400);
    expect(w.peakHz).toBeGreaterThan(300);
    expect(w.peakHz).toBeLessThan(360);
    expect(g.decayS).toBeGreaterThan(5 * w.decayS);
    expect(c.decayS).toBeLessThan(w.decayS * 1.5);
    expect(g.tonalityDb).toBeGreaterThan(c.tonalityDb + 10);
    expect(g.vector).toHaveLength(20);
  });

  it('do not depend on how hard you knock', () => {
    const soft = knockFeatures(knock('wood', 3, 0.1), SR);
    const hard = knockFeatures(knock('wood', 3, 0.8), SR);
    for (let d = 0; d < 16; d++)
      expect(Math.abs(soft.vector[d] - hard.vector[d])).toBeLessThan(0.15);
  });
});

describe('kNN', () => {
  it('separates the taught materials (leave-one-out)', () => {
    expect(leaveOneOut(examples)).toBe(1);
  });

  it('identifies new knocks with high confidence', () => {
    const m = trainKnock(examples);
    expect(m.labels).toEqual(['cardboard', 'glass', 'wood']);
    for (const k of kinds) {
      const g = classifyKnock(m, knockFeatures(knock(k, 999), SR));
      expect(g.label).toBe(k);
      expect(g.confidence).toBeGreaterThan(0.6);
      expect(g.novelty).toBeLessThan(3);
    }
  });

  it('says "unknown" for something unlike any example', () => {
    const m = trainKnock(examples.filter((e) => e.label !== 'glass'));
    const g = classifyKnock(m, knockFeatures(knock('glass', 5), SR));
    expect(g.label).toBeNull();
    expect(g.novelty).toBeGreaterThan(3);
  });

  it('uses the IMU feature only when every example has it', () => {
    const withImu = examples.map((e, i) => ({
      ...e,
      features: knockFeatures(
        knock(e.label as (typeof kinds)[number], 100 + i),
        SR,
        e.label === 'glass' ? 0.5 : 3,
      ),
    }));
    expect(trainKnock(withImu).dims).toBe(21);
    expect(trainKnock([...withImu, examples[0]]).dims).toBe(20);
    expect(classifyKnock(trainKnock([]), examples[0].features).label).toBeNull();
    expect(leaveOneOut(examples.slice(0, 2))).toBeNull();
  });

  it('works on knocks found by the onset detector in a recording', () => {
    const rec = new Float64Array(SR * 2);
    const one = knock('wood', 42);
    for (const at of [0.3, 1.1]) rec.set(one, Math.round(at * SR));
    const onsets = detectOnsets(rec, SR);
    expect(onsets).toHaveLength(2);
    const f = knockFeatures(rec.subarray(onsets[0].sample), SR);
    expect(classifyKnock(trainKnock(examples), f).label).toBe('wood');
  });
});

describe('firmness index', () => {
  it('is f²·m^(2/3)', () => {
    expect(firmnessIndex(100, 1)).toBeCloseTo(10000, 9);
    expect(firmnessIndex(200, 8)).toBeCloseTo(40000 * 4, 6);
  });
});
