/** Minimal WAV (RIFF) encode/decode: mono or multi-channel, PCM16 or float32. No browser APIs. */

export interface WavData {
  sampleRate: number;
  channels: Float32Array[];
}

export function encodeWav(
  channels: Float32Array | Float32Array[],
  sampleRate: number,
  format: 'float32' | 'pcm16' = 'float32',
): ArrayBuffer {
  const chans = Array.isArray(channels) ? channels : [channels];
  const numCh = chans.length;
  const frames = chans[0]?.length ?? 0;
  const bytesPerSample = format === 'float32' ? 4 : 2;
  const dataBytes = frames * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, format === 'float32' ? 3 : 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, bytesPerSample * 8, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = chans[c][i];
      if (format === 'float32') v.setFloat32(o, s, true);
      else v.setInt16(o, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true);
      o += bytesPerSample;
    }
  }
  return buf;
}

export function decodeWav(buf: ArrayBuffer): WavData {
  const v = new DataView(buf);
  const tag = (o: number) =>
    String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12;
  let fmt: { audioFormat: number; numCh: number; sampleRate: number; bits: number } | null = null;
  while (o + 8 <= v.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: v.getUint16(body, true),
        numCh: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt');
      const { audioFormat, numCh, bits } = fmt;
      const isFloat = audioFormat === 3 && bits === 32;
      const isPcm16 = audioFormat === 1 && bits === 16;
      if (!isFloat && !isPcm16) throw new Error(`Unsupported WAV format ${audioFormat}/${bits}`);
      const bps = bits / 8;
      const frames = Math.floor(Math.min(size, v.byteLength - body) / (bps * numCh));
      const channels = Array.from({ length: numCh }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < numCh; c++) {
          channels[c][i] = isFloat ? v.getFloat32(p, true) : v.getInt16(p, true) / 32768;
          p += bps;
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    o = body + size + (size % 2);
  }
  throw new Error('No data chunk');
}
