/** Bucket drawing filled to `litres / capacity`. The water level animates when it changes. */
export function LitresGauge({ litres, capacity }: { litres: number; capacity: number }) {
  const frac = Math.max(0, Math.min(1, capacity > 0 ? litres / capacity : 0));
  const yTop = 14;
  const yBot = 92;
  const wy = yBot - frac * (yBot - yTop);
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
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="80"
          x2="85"
          y1={yBot - f * (yBot - yTop)}
          y2={yBot - f * (yBot - yTop)}
          className="gauge-tick"
        />
      ))}
    </svg>
  );
}
