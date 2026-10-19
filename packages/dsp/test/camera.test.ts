import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  bucketFromViews,
  CARD_MM,
  cardHomography,
  createRng,
  fitCircle,
  homography,
  measureSideView,
  measureTopView,
  REFERENCES,
  waterDepthWithShape,
  type Point,
} from '../src';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];

/** Pinhole camera at `eye` looking at `at` (world z up, mm), f in px, 4000×3000 image. */
function camera(eye: V3, at: V3, f = 3000) {
  const fwd = unit(sub(at, eye));
  const right = unit(cross(fwd, [0, 0, 1]));
  const down = cross(fwd, right);
  return (p: V3): Point => {
    const d = sub(p, eye);
    const z = dot(d, fwd);
    return { x: 2000 + (f * dot(d, right)) / z, y: 1500 + (f * dot(d, down)) / z };
  };
}

const R = 140; // inside rim radius, mm
const r = 110; // base radius
const Hout = 250; // outside height, mm (24 cm inside + 1 cm base)

describe('homography', () => {
  it('maps four points exactly and is consistent on others', () => {
    const src = [
      { x: 100, y: 120 },
      { x: 900, y: 80 },
      { x: 950, y: 700 },
      { x: 60, y: 650 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];
    const H = homography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo(dst[i].x, 9);
      expect(q.y).toBeCloseTo(dst[i].y, 9);
    });
  });

  it('orders card corners from any tap order, long edge first', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 856, y: 0 },
      { x: 856, y: 540 },
      { x: 0, y: 540 },
    ];
    for (const order of [
      [0, 1, 2, 3],
      [2, 0, 3, 1],
      [3, 2, 1, 0],
    ]) {
      const { H } = cardHomography(order.map((i) => corners[i]));
      const a = applyHomography(H, corners[0]);
      const b = applyHomography(H, corners[1]);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(CARD_MM.width, 6);
    }
    expect(() => cardHomography(corners.slice(0, 3))).toThrow();
  });

  it('fits a circle', () => {
    const pts = [0, 1, 2, 4].map((k) => ({ x: 3 + 5 * Math.cos(k), y: -2 + 5 * Math.sin(k) }));
    const c = fitCircle(pts);
    expect(c.r).toBeCloseTo(5, 9);
    expect(c.cx).toBeCloseTo(3, 9);
    expect(c.rms).toBeLessThan(1e-9);
  });
});

describe('top view: card on the rim', () => {
  const project = camera([60, -90, Hout + 650], [0, 0, Hout]);
  // Card lying across the rim, long edge along x, in the rim plane.
  const card: V3[] = [
    [80, -27, Hout],
    [80 + CARD_MM.width, -27, Hout],
    [80 + CARD_MM.width, -27 + CARD_MM.height, Hout],
    [80, -27 + CARD_MM.height, Hout],
  ];
  const rim = [0.3, 1.4, 2.2, 3.1, 4.0, 5.2].map((a): V3 => [
    R * Math.cos(a),
    R * Math.sin(a),
    Hout,
  ]);

  it('measures the rim exactly from an oblique photo', () => {
    const t = measureTopView({ card: card.map(project), rim: rim.map(project) });
    expect(t.diameterCm).toBeCloseTo(28, 6);
  });

  it('with ±2 px tap noise, stays within twice its own ±', () => {
    const rng = createRng(4);
    const jitter = (p: Point) => ({ x: p.x + 2 * rng.gaussian(), y: p.y + 2 * rng.gaussian() });
    const t = measureTopView({
      card: card.map(project).map(jitter),
      rim: rim.map(project).map(jitter),
    });
    // A ~400 px card: corner taps dominate, about ±0.9 cm (1σ) on a 28 cm rim.
    expect(Math.abs(t.diameterCm - 28)).toBeLessThan(2 * t.uncertaintyCm);
  });

  it('its ± is calibrated: about 68% of errors fall within 1σ (Monte Carlo)', () => {
    const N = 200;
    let within = 0;
    for (let seed = 1; seed <= N; seed++) {
      const rng = createRng(seed);
      const jitter = (p: Point) => ({ x: p.x + 2 * rng.gaussian(), y: p.y + 2 * rng.gaussian() });
      const t = measureTopView(
        { card: card.map(project).map(jitter), rim: rim.map(project).map(jitter) },
        2,
      );
      if (Math.abs(t.diameterCm - 28) < t.uncertaintyCm) within++;
    }
    expect(within / N).toBeGreaterThan(0.58);
    expect(within / N).toBeLessThan(0.8);
  });
});

describe('top view: an A4 sheet on the rim', () => {
  it('is exact without noise and ~3× tighter than a card with the same tap noise', () => {
    const project = camera([60, -90, Hout + 650], [0, 0, Hout]);
    const a4 = REFERENCES.a4;
    const sheet: V3[] = [
      [40, -a4.height / 2, Hout],
      [40 + a4.width, -a4.height / 2, Hout],
      [40 + a4.width, a4.height / 2, Hout],
      [40, a4.height / 2, Hout],
    ];
    const rim = [1.6, 2.4, 3.1, 3.9, 4.7].map((a): V3 => [R * Math.cos(a), R * Math.sin(a), Hout]);
    const exact = measureTopView({ card: sheet.map(project), rim: rim.map(project), ref: a4 });
    expect(exact.diameterCm).toBeCloseTo(28, 6);
    const rng = createRng(9);
    const jitter = (p: Point) => ({ x: p.x + 2 * rng.gaussian(), y: p.y + 2 * rng.gaussian() });
    const t = measureTopView(
      { card: sheet.map(project).map(jitter), rim: rim.map(project).map(jitter), ref: a4 },
      2,
    );
    expect(t.uncertaintyCm).toBeLessThan(0.4);
    expect(Math.abs(t.diameterCm - 28)).toBeLessThan(2 * t.uncertaintyCm);
  });
});

describe('side view: card taped to the wall', () => {
  const project = camera([0, -1500, Hout / 2], [0, 0, Hout / 2]);
  // The wall's front line, base (0, −r, 0) to rim (0, −R, Hout); the card lies in the plane
  // tangent to the cone along it, centred at mid height, long edge vertical (along that
  // straight line, so the card lies flat on the curved wall).
  const g = unit([0, -(R - r), Hout]);
  const mid: V3 = [0, -(r + R) / 2, Hout / 2];
  const card: V3[] = [
    add(add(mid, [1, 0, 0], -CARD_MM.height / 2), g, CARD_MM.width / 2),
    add(add(mid, [1, 0, 0], CARD_MM.height / 2), g, CARD_MM.width / 2),
    add(add(mid, [1, 0, 0], CARD_MM.height / 2), g, -CARD_MM.width / 2),
    add(add(mid, [1, 0, 0], -CARD_MM.height / 2), g, -CARD_MM.width / 2),
  ];
  const silhouette = (radius: number, z: number) => {
    let lo: Point = { x: Infinity, y: 0 };
    let hi: Point = { x: -Infinity, y: 0 };
    for (let k = 0; k < 3600; k++) {
      const a = (k / 3600) * 2 * Math.PI;
      const p = project([radius * Math.cos(a), radius * Math.sin(a), z]);
      if (p.x < lo.x) lo = p;
      if (p.x > hi.x) hi = p;
    }
    return [lo, hi];
  };
  const [tl, tr] = silhouette(R, Hout);
  const [bl, br] = silhouette(r, 0);
  const waterZ = 150;
  const side = measureSideView({
    card: card.map(project),
    rimFront: project([0, -R, Hout]),
    baseFront: project([0, -r, 0]),
    waterFront: project([0, -(r + ((R - r) * waterZ) / Hout), waterZ]),
    topLeft: tl,
    topRight: tr,
    bottomLeft: bl,
    bottomRight: br,
  });

  it('measures the slant height exactly and the taper ratio within 2%', () => {
    expect(side.slantCm).toBeCloseTo(Math.hypot(Hout, R - r) / 10, 6);
    expect(Math.abs(side.taperRatio / (r / R) - 1)).toBeLessThan(0.02);
  });

  it('combines with the top view into inside dimensions and water depth', () => {
    const top = { diameterCm: 28, uncertaintyCm: 0.1, circle: { cx: 0, cy: 0, r: 140, rms: 0 } };
    const b = bucketFromViews(top, side, 1);
    expect(b.topDiameterCm).toBe(28);
    expect(Math.abs(b.bottomDiameterCm - 22)).toBeLessThan(0.45);
    expect(Math.abs(b.heightCm - 24)).toBeLessThan(0.05);
    expect(Math.abs(b.waterDepthCm! - 14)).toBeLessThan(0.05);
    expect(b.uncertainty.heightCm).toBeGreaterThan(0.3);
  });

  it('waterline with a known shape gives the same depth', () => {
    const shape = { topDiameterCm: 28, bottomDiameterCm: 22, heightCm: 24 };
    expect(waterDepthWithShape(side.waterSlantCm!, shape, 1)).toBeCloseTo(14, 6);
  });
});
