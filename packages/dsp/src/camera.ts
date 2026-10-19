import { solveLinear } from './fit';

/**
 * Container dimensions from photos with a bank card for scale.
 *
 * A bank card is an ISO/IEC 7810 ID-1 card: 85.60 × 53.98 mm. Its four corners fix a
 * homography from the photo to the card's own plane, in millimetres. Points that lie in
 * that plane are then measured exactly, whatever the camera angle:
 *
 * - **Top view:** the card lies flat on the rim, so the rim is in the card's plane. Points
 *   tapped around the inside of the rim are mapped to mm and a circle is fitted.
 * - **Side view:** the card is taped flat on the side wall, so the wall's front line (the
 *   generator of the cone through the card) is in its plane. The rim-to-base distance along
 *   it is the slant height; the taper ratio comes from the silhouette widths.
 *
 * Points not in the card's plane (the silhouette edges) carry perspective error ≈ r/D, so
 * they are only used for a ratio, where it cancels.
 */

export const CARD_MM = { width: 85.6, height: 53.98 };

/**
 * Flat references with exactly known sizes, long side first. Scale error shrinks with the
 * reference's size, so a sheet of paper on the rim beats a card about 3.5×.
 */
export const REFERENCES = {
  card: CARD_MM,
  a4: { width: 297, height: 210 },
  letter: { width: 279.4, height: 215.9 },
} as const;
export type ReferenceSize = { width: number; height: number };

export interface Point {
  x: number;
  y: number;
}

/** Row-major 3×3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Homography H with H·src[i] ∝ dst[i], from exactly four point pairs (DLT, h₃₃ = 1). */
export function homography(src: Point[], dst: Point[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('Need four point pairs');
  // Normalise both sides for a well-conditioned solve.
  const norm = (pts: Point[]) => {
    const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
    const cy = pts.reduce((a, p) => a + p.y, 0) / 4;
    const s = pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / 4 || 1;
    return { cx, cy, s, pts: pts.map((p) => ({ x: (p.x - cx) / s, y: (p.y - cy) / s })) };
  };
  const a = norm(src);
  const b = norm(dst);
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = a.pts[i];
    const { x: u, y: v } = b.pts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const h = solveLinear(A, rhs);
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Undo the normalisation: H = Tb⁻¹ · Hn · Ta.
  const Ta: Mat3 = [1 / a.s, 0, -a.cx / a.s, 0, 1 / a.s, -a.cy / a.s, 0, 0, 1];
  const TbInv: Mat3 = [b.s, 0, b.cx, 0, b.s, b.cy, 0, 0, 1];
  const H = mul(TbInv, mul(Hn, Ta));
  return H.map((v) => v / H[8]) as Mat3;
}

function mul(A: Mat3, B: Mat3): Mat3 {
  const C = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C;
}

export function applyHomography(H: Mat3, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Orders four tapped card corners (any order) around the card, starting so that the first
 * edge is a long one, and returns the image → card-mm homography.
 */
export function cardHomography(
  corners: Point[],
  ref: ReferenceSize = CARD_MM,
): { H: Mat3; ordered: Point[] } {
  if (corners.length !== 4) throw new Error('Tap the four corners of the card');
  const cx = corners.reduce((a, p) => a + p.x, 0) / 4;
  const cy = corners.reduce((a, p) => a + p.y, 0) / 4;
  const sorted = [...corners].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // Long edges (85.6 mm) still look longer than short ones (54 mm) unless the view is
  // extremely oblique; average the opposite pairs to decide.
  const e01 = dist(sorted[0], sorted[1]) + dist(sorted[2], sorted[3]);
  const e12 = dist(sorted[1], sorted[2]) + dist(sorted[3], sorted[0]);
  const ordered = e01 >= e12 ? sorted : [sorted[1], sorted[2], sorted[3], sorted[0]];
  const { width: W, height: Hh } = ref;
  const H = homography(ordered, [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: Hh },
    { x: 0, y: Hh },
  ]);
  return { H, ordered };
}

/**
 * Relative scale error (1σ) from imprecise card-corner taps: ≈ 6·tap / (card length in
 * px). Extrapolating the homography from an 86 mm card to a ~300 mm rim amplifies corner
 * errors; 6 was calibrated by Monte Carlo on simulated oblique photos with Gaussian tap
 * noise (68% of errors within 1σ). Fill the frame and tap the corners zoomed in.
 */
export function cardScaleError(card: Point[], tapPx: number): number {
  const sides = [0, 1, 2, 3].map((i) => dist(card[i], card[(i + 1) % 4]));
  return (6 * tapPx) / Math.max(...sides);
}

/** Millimetres per image pixel near `p` (geometric mean of the local x and y scales). */
export function localScale(H: Mat3, p: Point): number {
  const o = applyHomography(H, p);
  const dx = dist(o, applyHomography(H, { x: p.x + 1, y: p.y }));
  const dy = dist(o, applyHomography(H, { x: p.x, y: p.y + 1 }));
  return Math.sqrt(dx * dy);
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
  /** RMS distance of the points from the circle. */
  rms: number;
}

/** Algebraic (Kåsa) least-squares circle through ≥ 3 points. */
export function fitCircle(points: Point[]): Circle {
  if (points.length < 3) throw new Error('Need at least three points on the rim');
  // x² + y² + D·x + E·y + F = 0, linear in D, E, F.
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const v = [0, 0, 0];
  for (const { x, y } of points) {
    const row = [x, y, 1];
    const z = -(x * x + y * y);
    for (let i = 0; i < 3; i++) {
      v[i] += row[i] * z;
      for (let j = 0; j < 3; j++) M[i][j] += row[i] * row[j];
    }
  }
  const [D, E, F] = solveLinear(M, v);
  const cx = -D / 2;
  const cy = -E / 2;
  const r = Math.sqrt(Math.max(0, cx * cx + cy * cy - F));
  const rms = Math.sqrt(
    points.reduce((a, p) => a + (Math.hypot(p.x - cx, p.y - cy) - r) ** 2, 0) / points.length,
  );
  return { cx, cy, r, rms };
}

export interface TopViewInput {
  card: Point[];
  /** The reference's size (default: a bank card). */
  ref?: ReferenceSize;
  /** ≥ 3 taps on the inside edge of the rim. */
  rim: Point[];
}

export interface TopViewResult {
  diameterCm: number;
  /** ± from tap precision (≈ 3 px) and how round the fitted points are. */
  uncertaintyCm: number;
  circle: Circle;
}

/** Inside rim diameter from a top-down photo with the card lying on the rim. */
export function measureTopView(input: TopViewInput, tapPx = 3): TopViewResult {
  const { H } = cardHomography(input.card, input.ref);
  const mm = input.rim.map((p) => applyHomography(H, p));
  const circle = fitCircle(mm);
  const scale = localScale(H, input.rim[0]);
  const tapMm = (tapPx * scale) / Math.sqrt(Math.max(1, input.rim.length - 2));
  const d = 2 * circle.r;
  return {
    diameterCm: d / 10,
    uncertaintyCm:
      Math.hypot(2 * tapMm, 2 * circle.rms, cardScaleError(input.card, tapPx) * d) / 10,
    circle,
  };
}

export interface SideViewInput {
  card: Point[];
  /** Top of the rim, straight above the card. */
  rimFront: Point;
  /** Bottom edge of the base, straight below the card. */
  baseFront: Point;
  /** Waterline at the same line (translucent containers), optional. */
  waterFront?: Point | null;
  /** Silhouette edges, for the taper ratio. */
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

export interface SideViewResult {
  /** Rim to base along the wall, cm (exact: it lies in the card's plane). */
  slantCm: number;
  /** Base to waterline along the wall, cm. */
  waterSlantCm: number | null;
  /** Bottom width / top width (silhouettes; perspective cancels to first order). */
  taperRatio: number;
  uncertaintyCm: number;
}

export function measureSideView(input: SideViewInput, tapPx = 3): SideViewResult {
  const { H } = cardHomography(input.card);
  const rim = applyHomography(H, input.rimFront);
  const base = applyHomography(H, input.baseFront);
  const water = input.waterFront ? applyHomography(H, input.waterFront) : null;
  const scale = (localScale(H, input.rimFront) + localScale(H, input.baseFront)) / 2;
  return {
    slantCm: dist(rim, base) / 10,
    waterSlantCm: water ? dist(water, base) / 10 : null,
    taperRatio: dist(input.bottomLeft, input.bottomRight) / dist(input.topLeft, input.topRight),
    uncertaintyCm:
      Math.hypot(Math.SQRT2 * tapPx * scale, cardScaleError(input.card, tapPx) * dist(rim, base)) /
      10,
  };
}

export interface BucketDimensions {
  topDiameterCm: number;
  bottomDiameterCm: number;
  /** Inside height: outside height minus the base thickness. */
  heightCm: number;
  /** Water depth inside (side view with a waterline), cm. */
  waterDepthCm: number | null;
  uncertainty: { topCm: number; bottomCm: number; heightCm: number };
}

/**
 * Combines the two views. The slant height is converted to vertical with the radial
 * step between rim and base: h = √(s² − ((D_top − D_bottom)/2)²).
 */
export function bucketFromViews(
  top: TopViewResult,
  side: SideViewResult,
  baseThicknessCm = 1,
): BucketDimensions {
  const topD = top.diameterCm;
  const bottomD = topD * side.taperRatio;
  const step = (topD - bottomD) / 2;
  const vertical = (s: number) =>
    Math.sqrt(Math.max(0, s * s - step * step * (s / side.slantCm) ** 2));
  const outer = vertical(side.slantCm);
  const water = side.waterSlantCm != null ? vertical(side.waterSlantCm) : null;
  return {
    topDiameterCm: topD,
    bottomDiameterCm: bottomD,
    heightCm: Math.max(0, outer - baseThicknessCm),
    waterDepthCm: water != null ? Math.max(0, water - baseThicknessCm) : null,
    uncertainty: {
      topCm: top.uncertaintyCm,
      // The silhouette ratio is good to ~2% at 1.5 m.
      bottomCm: Math.hypot(top.uncertaintyCm * side.taperRatio, 0.02 * bottomD),
      heightCm: Math.hypot(side.uncertaintyCm, 0.3),
    },
  };
}

/**
 * Water depth inside a container of known shape from a side photo's base → waterline
 * slant (translucent containers): vertical = slant · H_out / slant_total, minus the base.
 */
export function waterDepthWithShape(
  waterSlantCm: number,
  shape: { topDiameterCm: number; bottomDiameterCm: number; heightCm: number },
  baseThicknessCm = 1,
): number {
  const step = (shape.topDiameterCm - shape.bottomDiameterCm) / 2;
  const outer = shape.heightCm + baseThicknessCm;
  return Math.max(0, (waterSlantCm * outer) / Math.hypot(outer, step) - baseThicknessCm);
}
