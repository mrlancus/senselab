import { useEffect, useRef, useState } from 'react';
import { detectOnsets } from '@senselab/dsp';
import { audio, concat } from '../audio/engine';
import { LiveMic } from './LiveMic';

export interface ImpactRecording {
  samples: Float32Array;
  sampleRate: number;
  /** |acceleration incl. gravity| samples (m/s²) with times in s from the recording start. */
  motion: { t: number; a: number }[] | null;
}

/** Peak motion deviation (m/s²) within ±window of each onset, or null without motion data. */
export function motionPeaks(rec: ImpactRecording, onsetsS: number[], windowS = 0.15) {
  const m = rec.motion;
  if (!m || m.length < 5) return onsetsS.map(() => null);
  const sorted = [...m.map((s) => s.a)].sort((a, b) => a - b);
  const base = sorted[sorted.length >> 1];
  return onsetsS.map((t) => {
    let peak = 0;
    for (const s of m)
      if (Math.abs(s.t - t) <= windowS) peak = Math.max(peak, Math.abs(s.a - base));
    return peak;
  });
}

/**
 * Records a few sharp impacts (knocks, taps) with a live counter, then hands the recording
 * over. The mic is held only while listening.
 */
export function ImpactRecorder({
  label,
  target = 5,
  maxS = 8,
  withMotion = false,
  onRecorded,
}: {
  label: string;
  target?: number;
  maxS?: number;
  withMotion?: boolean;
  onRecorded: (r: ImpactRecording) => void;
}) {
  const [listening, setListening] = useState(false);
  const [count, setCount] = useState(0);
  const [left, setLeft] = useState(maxS);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    setError(null);
    let lease;
    try {
      lease = await audio.acquire();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const sr = lease.info.sampleRate;
    const chunks: Float32Array[] = [];
    const motion: { t: number; a: number }[] = [];
    const t0 = performance.now();
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (g?.x != null)
        motion.push({ t: (performance.now() - t0) / 1000, a: Math.hypot(g.x, g.y ?? 0, g.z ?? 0) });
    };
    if (withMotion) window.addEventListener('devicemotion', onMotion);
    setListening(true);
    setCount(0);
    setLeft(maxS);
    await new Promise<void>((resolve) => {
      const off = audio.onChunk((c) => chunks.push(c));
      const timer = setInterval(() => {
        const elapsed = (performance.now() - t0) / 1000;
        setLeft(Math.max(0, Math.ceil(maxS - elapsed)));
        const n = detectOnsets(concat(chunks), sr, { minGapS: 0.25 }).length;
        setCount(n);
        if (elapsed >= maxS || n >= target) stop();
      }, 400);
      const stop = () => {
        clearInterval(timer);
        // Let the last impact ring out for a moment.
        setTimeout(() => {
          off();
          stopRef.current = null;
          resolve();
        }, 300);
      };
      stopRef.current = stop;
    });
    if (withMotion) window.removeEventListener('devicemotion', onMotion);
    lease.release();
    setListening(false);
    onRecorded({ samples: concat(chunks), sampleRate: sr, motion: withMotion ? motion : null });
  };

  return (
    <div className="stack">
      {listening ? (
        <div className="card stack listening">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Listening… {label}</strong>
            <span className="mono">{left}s</span>
          </div>
          <LiveMic />
          <div className="tap-dots" aria-label={`${count} heard`}>
            {Array.from({ length: target }, (_, i) => (
              <span key={i} className={i < count ? 'on' : ''} />
            ))}
          </div>
          <button onClick={() => stopRef.current?.()} disabled={count < 1}>
            Done
          </button>
        </div>
      ) : (
        <button className="primary block" onClick={start}>
          Start listening
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
