/** Small planar-geometry toolkit for course-sized areas (a few km across). */

export type LatLon = { lat: number; lon: number };
export type P = [number, number];

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

/** Equirectangular projection around an origin: metres east (x) and north (y). Accurate to well under 1% at course scale. */
export function projector(origin: LatLon): (p: LatLon) => P {
  const kx = M_PER_DEG_LON_EQ * Math.cos((origin.lat * Math.PI) / 180);
  return (p) => [(p.lon - origin.lon) * kx, (p.lat - origin.lat) * M_PER_DEG_LAT];
}

export const dist = (a: P, b: P): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function lineLength(line: readonly P[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += dist(line[i - 1]!, line[i]!);
  return s;
}

export function area(poly: readonly P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function centroid(poly: readonly P[]): P {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Shortest distance from a point to a polyline. */
export function distToLine(p: P, line: readonly P[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)));
  }
  return line.length === 1 ? dist(p, line[0]!) : best;
}

export function distToPoly(p: P, poly: readonly P[]): number {
  return pointInPoly(p, poly) ? 0 : distToLine(p, [...poly, poly[0]!]);
}

export function pointInPoly(p: P, poly: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(points: readonly P[], tolerance: number): P[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let index = -1;
  let maxD = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToLine(points[i]!, [first, last]);
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= tolerance || index < 0) return [first, last];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** Simplify until at most `max` points remain. */
export function simplifyTo(points: readonly P[], max: number, start = 0.5): P[] {
  let tol = start;
  let out = simplify(points, tol);
  while (out.length > max) {
    tol *= 1.6;
    out = simplify(points, tol);
  }
  return out;
}

/** Drops a repeated closing vertex so polygons are stored open. */
export const open = (poly: readonly P[]): P[] => {
  const a = poly[0];
  const b = poly[poly.length - 1];
  return a && b && a[0] === b[0] && a[1] === b[1] ? poly.slice(0, -1) : [...poly];
};
