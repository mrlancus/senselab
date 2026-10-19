import { useEffect, useRef, useState } from 'react';
import { ampToDb, rms } from '@senselab/dsp';
import { audio } from '../audio/engine';

/** Live input level meter fed by the shared audio engine. */
export function LiveMic() {
  const [db, setDb] = useState(-100);
  const [peakDb, setPeakDb] = useState(-100);
  const peak = useRef(-100);
  useEffect(() => {
    let last = 0;
    return audio.onChunk((c) => {
      const level = ampToDb(rms(c));
      peak.current = Math.max(peak.current - 0.5, level);
      const now = performance.now();
      if (now - last > 60) {
        last = now;
        setDb(level);
        setPeakDb(peak.current);
      }
    });
  }, []);
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v + 90) / 90) * 100))}%`;
  return (
    <div
      className="meter"
      role="meter"
      aria-valuenow={Math.round(db)}
      aria-valuemin={-90}
      aria-valuemax={0}
    >
      <div className="meter-fill" style={{ width: pct(db) }} />
      <div className="meter-peak" style={{ left: pct(peakDb) }} />
      <span className="meter-label mono">{db < -90 ? '< −90' : db.toFixed(0)} dBFS</span>
    </div>
  );
}
