import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../src';

describe('wav', () => {
  const x = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.9);

  it('round-trips float32 exactly', () => {
    const d = decodeWav(encodeWav(x, 48000));
    expect(d.sampleRate).toBe(48000);
    expect(Array.from(d.channels[0])).toEqual(Array.from(x));
  });

  it('round-trips pcm16 within quantisation and clips', () => {
    const y = Float32Array.from([...x, 2, -2]);
    const d = decodeWav(encodeWav(y, 44100, 'pcm16'));
    d.channels[0].slice(0, 100).forEach((v, i) => expect(Math.abs(v - x[i])).toBeLessThan(1e-4));
    expect(d.channels[0][100]).toBeCloseTo(1, 3);
    expect(d.channels[0][101]).toBeCloseTo(-1, 3);
  });

  it('handles stereo and rejects junk', () => {
    const d = decodeWav(encodeWav([x, x.map((v) => -v)], 8000));
    expect(d.channels).toHaveLength(2);
    expect(d.channels[1][3]).toBeCloseTo(-x[3]);
    expect(() => decodeWav(new ArrayBuffer(44))).toThrow(/Not a WAV/);
    const noData = encodeWav(x, 8000).slice(0, 36);
    expect(() => decodeWav(noData)).toThrow(/No data/);
  });
});
