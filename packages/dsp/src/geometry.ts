/** Inside dimensions of a bucket modelled as a truncated cone, in centimetres. */
export interface FrustumCm {
  topDiameterCm: number;
  bottomDiameterCm: number;
  heightCm: number;
}

/** Radius (cm) at height `h` above the bottom; linear between bottom and top. */
function radiusAt(f: FrustumCm, h: number): number {
  const r0 = f.bottomDiameterCm / 2;
  const r1 = f.topDiameterCm / 2;
  return r0 + ((r1 - r0) * h) / f.heightCm;
}

/**
 * Litres held when filled to `levelCm` above the bottom.
 * V = πh/3 (R² + Rr + r²) for a frustum of height h with end radii r and R; 1 L = 1000 cm³.
 */
export function frustumLitresAtLevel(f: FrustumCm, levelCm: number): number {
  const h = Math.min(Math.max(levelCm, 0), f.heightCm);
  const r = f.bottomDiameterCm / 2;
  const R = radiusAt(f, h);
  return (Math.PI * h * (R * R + R * r + r * r)) / 3 / 1000;
}

export function frustumCapacityLitres(f: FrustumCm): number {
  return frustumLitresAtLevel(f, f.heightCm);
}

/** Inverse of {@link frustumLitresAtLevel}: fill height (cm) that holds `litres`. Bisection. */
export function frustumLevelForLitres(f: FrustumCm, litres: number): number {
  if (litres <= 0) return 0;
  if (litres >= frustumCapacityLitres(f)) return f.heightCm;
  let lo = 0;
  let hi = f.heightCm;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (frustumLitresAtLevel(f, mid) < litres) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
