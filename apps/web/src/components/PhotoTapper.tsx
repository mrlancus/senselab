import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Point } from '@senselab/dsp';

export interface TapStep {
  key: string;
  prompt: string;
  /** Exact number of points, or a range for "as many as you like". */
  min: number;
  max: number;
  /** Shown as a skip button when min is 0. */
  optional?: boolean;
}

export type TapResult = Record<string, Point[]>;

const LOUPE = 120;
const ZOOM = 4;
/** Drag speed divisor after touching down. */
const FINE = 3;

/**
 * Shows a photo and collects taps step by step, in image pixel coordinates.
 *
 * A phone shows several photo pixels per screen pixel, so a plain tap is coarse. Instead,
 * touching drops a point under the finger, and dragging then moves it at 1/3 speed (fine
 * adjust) while a magnifier above the finger shows the point; it lands when the finger
 * lifts.
 */
export function PhotoTapper({
  file,
  steps,
  onDone,
}: {
  file: Blob;
  steps: TapStep[];
  /**
   * `tapPx`: how precisely a person can place a point, in photo pixels: about a third of a
   * screen pixel with the fine-adjust drag and 4× magnifier (at least 1 px).
   */
  onDone: (r: TapResult, info: { width: number; height: number; tapPx: number }) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<TapResult>({});
  const [hover, setHover] = useState<{
    start: Point;
    startImage: Point;
    image: Point;
    box: DOMRect;
  } | null>(null);

  const step = steps[stepIndex];
  const current = step ? (points[step.key] ?? []) : [];
  const scale = (box: DOMRect) => size!.width / box.width;
  const down = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const s = scale(box);
    const image = { x: (e.clientX - box.left) * s, y: (e.clientY - box.top) * s };
    return { start: { x: e.clientX, y: e.clientY }, startImage: image, image, box };
  };
  const moved = (h: NonNullable<typeof hover>, e: PointerEvent<SVGSVGElement>) => {
    const s = scale(h.box) / FINE;
    return {
      ...h,
      image: {
        x: h.startImage.x + (e.clientX - h.start.x) * s,
        y: h.startImage.y + (e.clientY - h.start.y) * s,
      },
    };
  };

  const add = (p: Point) => {
    if (!step || current.length >= step.max) return;
    const next = { ...points, [step.key]: [...current, p] };
    setPoints(next);
    if (step.min === step.max && current.length + 1 === step.max) advance(next);
  };
  const advance = (pts = points) => {
    if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1);
    else {
      const perCss = size!.width / (wrap.current?.clientWidth || size!.width);
      onDone(pts, { ...size!, tapPx: Math.max(1, perCss / 3) });
    }
  };
  const undo = () => {
    if (current.length) setPoints({ ...points, [step!.key]: current.slice(0, -1) });
    else if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  const r = size ? size.width / 120 : 4;
  const all = Object.entries(points);
  return (
    <div className="stack">
      {step && (
        <div className="row tap-prompt" style={{ justifyContent: 'space-between' }}>
          <strong>
            {stepIndex + 1}/{steps.length}: {step.prompt}
          </strong>
          <span className="mono small muted">
            {/* Fixed-height prompt: the photo must not move under the finger between steps. */}
            {current.length}
            {step.max < 99 ? `/${step.max}` : ''}
          </span>
        </div>
      )}
      <div className="tapper" ref={wrap}>
        <img
          src={url}
          alt="Photo to measure"
          onLoad={(e) =>
            setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
          }
        />
        {size && (
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setHover(down(e));
            }}
            onPointerMove={(e) => hover && setHover(moved(hover, e))}
            onPointerUp={(e) => {
              if (!hover) return;
              const h = moved(hover, e);
              setHover(null);
              add(h.image);
            }}
            onPointerCancel={() => setHover(null)}
          >
            {hover && (
              <g className="tap-pt on">
                <circle cx={hover.image.x} cy={hover.image.y} r={r} />
              </g>
            )}
            {all.map(([key, pts]) =>
              pts.map((p, i) => (
                <g key={`${key}${i}`} className={key === step?.key ? 'tap-pt on' : 'tap-pt'}>
                  <circle cx={p.x} cy={p.y} r={r} />
                  <line x1={p.x - 2 * r} x2={p.x + 2 * r} y1={p.y} y2={p.y} />
                  <line x1={p.x} x2={p.x} y1={p.y - 2 * r} y2={p.y + 2 * r} />
                </g>
              )),
            )}
          </svg>
        )}
        {hover &&
          size &&
          (() => {
            // Point position in CSS px within the photo.
            const px = hover.image.x / scale(hover.box);
            const py = hover.image.y / scale(hover.box);
            return (
              <div
                className="loupe"
                style={{
                  left: px - LOUPE / 2,
                  top: Math.max(-LOUPE / 2, py - LOUPE - 40),
                  width: LOUPE,
                  height: LOUPE,
                  backgroundImage: `url(${url})`,
                  backgroundSize: `${hover.box.width * ZOOM}px ${hover.box.height * ZOOM}px`,
                  backgroundPosition: `${-px * ZOOM + LOUPE / 2}px ${-py * ZOOM + LOUPE / 2}px`,
                }}
              />
            );
          })()}
      </div>
      <div className="row">
        <button className="small" onClick={undo} disabled={!current.length && stepIndex === 0}>
          Undo
        </button>
        {step && step.min !== step.max && (
          <button
            className="small primary"
            onClick={() => advance()}
            disabled={current.length < step.min}
          >
            {current.length === 0 && step.optional ? 'Skip' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}
