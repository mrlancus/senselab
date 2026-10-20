import type { TapFit } from '@senselab/dsp';

/** Litres (y) against tap pitch (x): calibration points, fitted curve and the latest reading. */
export function CalibrationChart({
  points,
  fit,
  reading,
}: {
  points: { litres: number; frequency: number }[];
  fit: TapFit | null;
  reading?: { frequency: number; litres: number } | null;
}) {
  const W = 320;
  const H = 180;
  const m = { l: 34, r: 10, t: 10, b: 26 };
  const fs = points.map((p) => p.frequency).concat(reading ? [reading.frequency] : []);
  const ls = points.map((p) => p.litres).concat(reading ? [reading.litres] : []);
  let fLo = Math.min(...fs);
  let fHi = Math.max(...fs);
  const pad = Math.max(10, (fHi - fLo) * 0.15);
  fLo -= pad;
  fHi += pad;
  const lHi = Math.max(1, ...ls) * 1.15;
  const x = (f: number) => m.l + ((f - fLo) / (fHi - fLo)) * (W - m.l - m.r);
  const y = (l: number) => H - m.b - (l / lHi) * (H - m.t - m.b);

  let curve = '';
  if (fit) {
    const n = 60;
    for (let i = 0; i <= n; i++) {
      const f = fLo + ((fHi - fLo) * i) / n;
      const l = Math.min(lHi, Math.max(0, fit.predict(f)));
      curve += `${i ? 'L' : 'M'}${x(f).toFixed(1)} ${y(l).toFixed(1)}`;
    }
  }
  const ticks = [0, lHi / 2, lHi].map((l) => Math.round(l * 10) / 10);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="cal-chart"
      role="img"
      aria-label="Calibration curve: litres against tap pitch"
    >
      <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="axis" />
      <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} className="axis" />
      {ticks.map((l) => (
        <text key={l} x={m.l - 4} y={y(l) + 3} className="tick" textAnchor="end">
          {l}
        </text>
      ))}
      <text x={m.l} y={H - 8} className="tick">
        {fLo.toFixed(0)} Hz
      </text>
      <text x={W - m.r} y={H - 8} className="tick" textAnchor="end">
        {fHi.toFixed(0)} Hz
      </text>
      <text x={4} y={m.t + 4} className="tick">
        L
      </text>
      {curve && <path d={curve} className="curve" />}
      {points.map((p, i) => (
        <circle key={i} cx={x(p.frequency)} cy={y(p.litres)} r={4} className="pt" />
      ))}
      {reading && (
        <circle cx={x(reading.frequency)} cy={y(reading.litres)} r={5} className="reading" />
      )}
    </svg>
  );
}
