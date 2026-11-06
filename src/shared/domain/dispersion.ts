export interface Ellipse {
  cx: number;
  cy: number;
  /** Semi-axis lengths. */
  rx: number;
  ry: number;
  /** Rotation of the rx axis from +x, in degrees. */
  angleDeg: number;
}

/**
 * k-sigma covariance ellipse for 2-D points. k = 2 contains ~86% of a
 * bivariate-normal cloud. Needs at least three points.
 */
export function dispersionEllipse(points: readonly { x: number; y: number }[], k = 2): Ellipse | null {
  const n = points.length;
  if (n < 3) return null;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  sxx /= n - 1;
  syy /= n - 1;
  sxy /= n - 1;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  const angle = sxy === 0 ? (sxx >= syy ? 0 : Math.PI / 2) : Math.atan2(l1 - sxx, sxy);
  return { cx, cy, rx: k * Math.sqrt(l1), ry: k * Math.sqrt(l2), angleDeg: (angle * 180) / Math.PI };
}
