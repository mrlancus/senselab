import { useEffect, useRef } from 'react';
import type { Spectrogram } from '@senselab/dsp';

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Sizes a canvas to its CSS box at device pixel ratio and calls draw(ctx, w, h). */
function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export interface Marker {
  /** Position in x units (seconds for waveforms, Hz or samples for line plots). */
  x: number;
  label?: string;
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markers: Marker[],
  toPx: (x: number) => number,
  h: number,
) {
  ctx.strokeStyle = cssVar('--warn');
  ctx.fillStyle = cssVar('--warn');
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (const m of markers) {
    const px = toPx(m.x);
    ctx.beginPath();
    ctx.moveTo(px + 0.5, 0);
    ctx.lineTo(px + 0.5, h);
    ctx.stroke();
    if (m.label) ctx.fillText(m.label, px + 3, 11);
  }
}

/** Min/max-decimated waveform, so long recordings draw fast. */
export function Waveform({
  data,
  sampleRate,
  markers = [],
  height = 90,
}: {
  data: Float32Array;
  sampleRate: number;
  markers?: Marker[];
  height?: number;
}) {
  const ref = useCanvas(
    (ctx, w, h) => {
      ctx.fillStyle = cssVar('--surface-2');
      ctx.fillRect(0, 0, w, h);
      let peak = 1e-6;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
      const mid = h / 2;
      const scale = (h / 2 - 2) / peak;
      ctx.fillStyle = cssVar('--accent');
      const per = data.length / w;
      for (let x = 0; x < w; x++) {
        let lo = 0;
        let hi = 0;
        const a = Math.floor(x * per);
        const b = Math.min(data.length, Math.floor((x + 1) * per) + 1);
        for (let i = a; i < b; i++) {
          const v = data[i]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        ctx.fillRect(x, mid - hi * scale, 1, Math.max(1, (hi - lo) * scale));
      }
      const dur = data.length / sampleRate;
      drawMarkers(ctx, markers, (t) => (t / dur) * w, h);
      ctx.fillStyle = cssVar('--muted');
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${dur.toFixed(2)} s · peak ${peak.toFixed(3)}`, 4, h - 4);
    },
    [data, sampleRate, markers],
  );
  return <canvas ref={ref} className="plot" style={{ height }} />;
}

/** A single series on linear axes; x = x0 + i·dx. */
export function LinePlot({
  y,
  x0 = 0,
  dx = 1,
  markers = [],
  height = 110,
  xUnit = '',
}: {
  y: ArrayLike<number>;
  x0?: number;
  dx?: number;
  markers?: Marker[];
  height?: number;
  xUnit?: string;
}) {
  const ref = useCanvas(
    (ctx, w, h) => {
      ctx.fillStyle = cssVar('--surface-2');
      ctx.fillRect(0, 0, w, h);
      if (!y.length) return;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < y.length; i++) {
        lo = Math.min(lo, y[i]!);
        hi = Math.max(hi, y[i]!);
      }
      if (hi === lo) hi = lo + 1;
      const pad = 6;
      const toY = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
      ctx.strokeStyle = cssVar('--accent');
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      const per = Math.max(1, y.length / w);
      for (let x = 0; x < w; x++) {
        const a = Math.floor(x * per);
        const b = Math.min(y.length, Math.floor((x + 1) * per));
        let m = -Infinity;
        for (let i = a; i < Math.max(a + 1, b); i++) m = Math.max(m, y[Math.min(i, y.length - 1)]!);
        const px = (x / w) * w;
        if (x === 0) ctx.moveTo(px, toY(m));
        else ctx.lineTo(px, toY(m));
        if (y.length < w && b >= y.length) break;
      }
      ctx.stroke();
      const xMax = x0 + dx * (y.length - 1);
      drawMarkers(ctx, markers, (x) => ((x - x0) / (xMax - x0 || 1)) * w, h);
      ctx.fillStyle = cssVar('--muted');
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${fmt(x0)}${xUnit}`, 4, h - 4);
      const right = `${fmt(xMax)}${xUnit}`;
      ctx.fillText(right, w - ctx.measureText(right).width - 4, h - 4);
    },
    [y, x0, dx, markers, xUnit],
  );
  return <canvas ref={ref} className="plot" style={{ height }} />;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(v % 1 ? 2 : 0);

/** Spectrogram heat-map: time left→right, frequency bottom→top. */
export function SpectrogramView({
  sg,
  maxHz = 24000,
  minDb = -110,
  maxDb = -20,
  height = 140,
}: {
  sg: Spectrogram;
  maxHz?: number;
  minDb?: number;
  maxDb?: number;
  height?: number;
}) {
  const ref = useCanvas(
    (ctx, w, h) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      if (!sg.frames.length) return;
      const bins = Math.min(sg.frames[0]!.length, Math.ceil(maxHz / sg.binHz));
      const img = ctx.createImageData(sg.frames.length, bins);
      for (let t = 0; t < sg.frames.length; t++) {
        const f = sg.frames[t]!;
        for (let k = 0; k < bins; k++) {
          const v = Math.max(0, Math.min(1, (f[k]! - minDb) / (maxDb - minDb)));
          const [r, g, b] = heat(v);
          const o = ((bins - 1 - k) * sg.frames.length + t) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      off.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${(Math.min(maxHz, bins * sg.binHz) / 1000).toFixed(0)} kHz`, 4, 11);
      ctx.fillText('0', 4, h - 4);
    },
    [sg, maxHz, minDb, maxDb],
  );
  return <canvas ref={ref} className="plot" style={{ height }} />;
}

/** Perceptual-ish dark→teal→yellow ramp. */
function heat(v: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [5, 8, 20],
    [20, 60, 110],
    [20, 160, 150],
    [240, 220, 80],
    [255, 255, 255],
  ];
  const x = v * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const t = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Per-band SNR bars for the sweep test, with the chosen chirp band highlighted. */
export function BandChart({
  bands,
  highlight,
  minSnrDb = 15,
}: {
  bands: { fLo: number; fHi: number; snrDb: number }[];
  highlight?: { f0: number; f1: number } | null;
  minSnrDb?: number;
}) {
  const W = 320;
  const H = 150;
  const top = 8;
  const base = H - 22;
  const max = Math.max(40, ...bands.map((b) => b.snrDb));
  const y = (db: number) => base - (Math.max(0, db) / max) * (base - top);
  const bw = W / Math.max(1, bands.length);
  return (
    <svg
      className="band-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Signal-to-noise ratio per frequency band"
    >
      <line x1="0" x2={W} y1={y(minSnrDb)} y2={y(minSnrDb)} className="threshold" />
      <text x={W - 2} y={y(minSnrDb) - 3} className="tick" textAnchor="end">
        {minSnrDb} dB
      </text>
      {bands.map((b, i) => {
        const inBand = !!highlight && b.fLo >= highlight.f0 && b.fHi <= highlight.f1;
        const cls = inBand ? 'bar chosen' : b.snrDb >= minSnrDb ? 'bar good' : 'bar weak';
        return (
          <g key={b.fLo}>
            <rect
              x={i * bw + 1}
              width={bw - 2}
              y={y(b.snrDb)}
              height={base - y(b.snrDb)}
              className={cls}
            >
              <title>{`${b.fLo}–${b.fHi} Hz: ${b.snrDb.toFixed(1)} dB SNR`}</title>
            </rect>
            {i % 3 === 0 && (
              <text x={i * bw + bw / 2} y={H - 8} className="tick" textAnchor="middle">
                {b.fLo >= 1000 ? `${b.fLo / 1000}k` : b.fLo}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
