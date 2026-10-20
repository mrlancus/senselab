import { frustumCapacityLitres, frustumLevelForLitres, type FrustumCm } from '@senselab/dsp';

/** The drawing's own taper (top 72, bottom 52, height 78 SVG units), used without a real shape. */
const DRAWN: FrustumCm = { topDiameterCm: 72, bottomDiameterCm: 52, heightCm: 78 };

/** Fill height (0..1 of the container height) holding `litres` of `capacity`. */
function heightFraction(litres: number, capacity: number, shape?: FrustumCm | null) {
  const frac = Math.max(0, Math.min(1, capacity > 0 ? litres / capacity : 0));
  // A tapered bucket is wider at the top, so half the volume sits below half the height.
  const f = shape ?? DRAWN;
  return frustumLevelForLitres(f, frac * frustumCapacityLitres(f)) / f.heightCm;
}

/**
 * Bucket drawing filled to `litres` of `capacity`. The water line is drawn at the right
 * height for a tapered bucket (the real shape when known), and the ticks mark quarter
 * volumes, not quarter heights. The water level animates when it changes.
 */
export function LitresGauge({
  litres,
  capacity,
  shape,
}: {
  litres: number;
  capacity: number;
  shape?: FrustumCm | null;
}) {
  const yTop = 14;
  const yBot = 92;
  const wy = yBot - heightFraction(litres, capacity, shape) * (yBot - yTop);
  return (
    <svg
      viewBox="0 0 100 100"
      className="gauge"
      role="img"
      aria-label={`${litres.toFixed(1)} of ${capacity.toFixed(1)} litres`}
    >
      <defs>
        <clipPath id="bucket-clip">
          <path d="M14 14 L86 14 L76 92 L24 92 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#bucket-clip)">
        <rect x="0" y={wy} width="100" height={100 - wy} className="gauge-water" />
      </g>
      <path d="M14 14 L86 14 L76 92 L24 92 Z" className="gauge-bucket" />
      {[0.25, 0.5, 0.75].map((f) => {
        const ty = yBot - heightFraction(f, 1, shape) * (yBot - yTop);
        return <line key={f} x1="80" x2="85" y1={ty} y2={ty} className="gauge-tick" />;
      })}
    </svg>
  );
}
