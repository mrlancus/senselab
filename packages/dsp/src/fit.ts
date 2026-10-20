/** Curve fitting and interpolation for calibration curves. */

/** Solves A·x = b by Gaussian elimination with partial pivoting. A is row-major n×n. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('Singular system');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
}

export function linearFit(xs: ArrayLike<number>, ys: ArrayLike<number>): LinearFit {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new Error('Need ≥2 paired points');
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) throw new Error('All x values equal');
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/** Least-squares polynomial; returns coefficients in ascending order (c0 + c1·x + …). */
export function polyFit(xs: ArrayLike<number>, ys: ArrayLike<number>, degree: number): number[] {
  if (xs.length <= degree) throw new Error(`Need > ${degree} points for degree ${degree}`);
  const m = degree + 1;
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b = new Array<number>(m).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const pw = [1];
    for (let k = 1; k < 2 * m; k++) pw.push(pw[k - 1] * xs[i]);
    for (let r = 0; r < m; r++) {
      b[r] += pw[r] * ys[i];
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c];
    }
  }
  return solveLinear(A, b);
}

export function polyEval(coeffs: readonly number[], x: number): number {
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) y = y * x + coeffs[i];
  return y;
}

function sortedPairs(xs: ArrayLike<number>, ys: ArrayLike<number>) {
  const idx = Array.from({ length: xs.length }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const x = idx.map((i) => xs[i]);
  const y = idx.map((i) => ys[i]);
  for (let i = 1; i < x.length; i++) {
    if (x[i] === x[i - 1]) throw new Error('Duplicate x values');
  }
  return { x, y };
}

/** Piecewise-linear interpolation with linear extrapolation from the end segments. */
export function linearInterpolator(xs: ArrayLike<number>, ys: ArrayLike<number>) {
  if (xs.length < 2) throw new Error('Need ≥2 points');
  const { x, y } = sortedPairs(xs, ys);
  return (v: number) => {
    let i = 0;
    while (i < x.length - 2 && v > x[i + 1]) i++;
    const t = (v - x[i]) / (x[i + 1] - x[i]);
    return y[i] + t * (y[i + 1] - y[i]);
  };
}

/**
 * Monotone cubic (Fritsch–Carlson PCHIP) interpolation. If the data is monotone the curve
 * is too: no overshoot between calibration points. Extrapolates linearly using end slopes.
 */
export function pchip(xs: ArrayLike<number>, ys: ArrayLike<number>) {
  if (xs.length < 2) throw new Error('Need ≥2 points');
  const { x, y } = sortedPairs(xs, ys);
  const n = x.length;
  const h = x.slice(1).map((v, i) => v - x[i]);
  const d = h.map((hi, i) => (y[i + 1] - y[i]) / hi);
  const m = new Array<number>(n);
  if (n === 2) {
    m[0] = m[1] = d[0];
  } else {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    const end = (h0: number, h1: number, d0: number, d1: number) => {
      let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(s) !== Math.sign(d0)) s = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0;
      return s;
    };
    m[0] = end(h[0], h[1], d[0], d[1]);
    m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return (v: number) => {
    if (v <= x[0]) return y[0] + m[0] * (v - x[0]);
    if (v >= x[n - 1]) return y[n - 1] + m[n - 1] * (v - x[n - 1]);
    let i = 0;
    while (v > x[i + 1]) i++;
    const t = (v - x[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * y[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * y[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    );
  };
}
