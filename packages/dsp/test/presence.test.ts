import { describe, expect, it } from 'vitest';
import {
  breathingRate,
  chirp,
  createRng,
  meanProfile,
  motionIndex,
  pingFrames,
  speedOfSound,
} from '../src';
import { fractionalDelay, SR } from './synth';

const C = speedOfSound(20);
const PERIOD = 2400; // 50 ms → 20 pings/s
const ping = chirp({ f0: 17000, f1: 21000, durationS: 0.005, sampleRate: SR, fadeS: 0.001 });

/**
 * `seconds` of pinging. Paths: direct (phone), a wall at 120 cm, and optionally a chest at
 * 60 cm breathing (displacement d(t) = amp·sin(2π·rate·t)) or a person walking away.
 */
function scene(opts: {
  seconds: number;
  breath?: { rateHz: number; ampMm: number };
  walker?: boolean;
  seed?: number;
}) {
  const rng = createRng(opts.seed ?? 1);
  const n = Math.round(opts.seconds * SR) + PERIOD;
  const x = new Float64Array(n);
  const first = 1000;
  const len = ping.length + 64;
  const add = (at: number, gain: number) => {
    const i0 = Math.floor(at);
    const p = fractionalDelay(ping, at - i0, len);
    for (let i = 0; i < len && i0 + i < n; i++) x[i0 + i] += gain * p[i];
  };
  // Ping right to the end, as a live stream would: every frame holds a ping.
  for (let k = 0; first + k * PERIOD < n; k++) {
    const t = (k * PERIOD) / SR;
    const base = first + k * PERIOD;
    const delay = (cm: number) => (2 * (cm / 100) * SR) / C;
    add(base, 1);
    add(base + delay(120), 0.2);
    if (opts.breath) {
      const d = 60 + (opts.breath.ampMm / 10) * Math.sin(2 * Math.PI * opts.breath.rateHz * t);
      add(base + delay(d), 0.05);
    }
    // Someone walking slowly away, staying within the 2 m window.
    if (opts.walker) add(base + delay(60 + 30 * t), 0.08);
  }
  for (let i = 0; i < n; i++) x[i] += 0.002 * rng.gaussian();
  return { x, first };
}

const bins = Math.round((2 * 2 * SR) / C); // 2 m of range
const binOf = (cm: number) => 48 + Math.round((2 * (cm / 100) * SR) / C);

describe('presence sonar', () => {
  it('frames every ping', () => {
    const { x, first } = scene({ seconds: 2 });
    const f = pingFrames(x, ping, first, PERIOD, bins);
    expect(f.frames.length).toBeGreaterThanOrEqual(39);
    expect(f.frames[0]).toHaveLength(bins * 2);
  });

  it('measures breathing rate (15 /min, 3 mm) at the right distance', () => {
    const { x, first } = scene({ seconds: 30, breath: { rateHz: 0.25, ampMm: 3 } });
    const { frames } = pingFrames(x, ping, first, PERIOD, bins);
    const b = breathingRate(frames, SR / PERIOD, binOf(20), binOf(110))!;
    expect(Math.abs(b.bpm - 15)).toBeLessThan(1);
    expect(b.snrDb).toBeGreaterThan(15);
    // A 3 mm swing is ±2 rad of phase, so the cleanest fundamental sits a little off the
    // echo peak (where the swing is linear): the range is good to ~10 cm (30 bins).
    expect(Math.abs(b.bin - binOf(60))).toBeLessThan(30);
  });

  it('finds no rhythm in a still room', () => {
    const { x, first } = scene({ seconds: 30, seed: 4 });
    const { frames } = pingFrames(x, ping, first, PERIOD, bins);
    expect(breathingRate(frames, SR / PERIOD, binOf(20), binOf(110))!.snrDb).toBeLessThan(12);
    expect(breathingRate(frames.slice(0, 100), SR / PERIOD, 0, 10)).toBeNull();
  });

  it('motion index: ~0 when still, large when someone walks past', () => {
    const still = scene({ seconds: 3, seed: 2 });
    const sf = pingFrames(still.x, ping, still.first, PERIOD, bins).frames;
    const bg = meanProfile(sf);
    const quiet = Math.max(...sf.map((f) => motionIndex(f, bg, binOf(20), binOf(180))));
    const walk = scene({ seconds: 3, walker: true, seed: 2 });
    const wf = pingFrames(walk.x, ping, walk.first, PERIOD, bins).frames;
    const moving = median(wf.slice(20).map((f) => motionIndex(f, bg, binOf(20), binOf(180))));
    expect(quiet).toBeLessThan(0.002);
    expect(moving).toBeGreaterThan(20 * quiet);
  });
});

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}
