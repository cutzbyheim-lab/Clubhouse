import type { HoleGeometry } from '@shared/schemas';
import { clamp, round1, type Rng } from './random';

export type Pt = readonly [number, number];

const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += dist(a, b);
  }
  return total;
}

/** Point at arc length `s` along a polyline, plus the unit normal (to the right). */
export function pointAlong(points: readonly Pt[], s: number): { p: Pt; normal: Pt } {
  let remaining = Math.max(0, s);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const seg = dist(a, b);
    if (remaining <= seg || i === points.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
      const dx = (b[0] - a[0]) / (seg || 1);
      const dy = (b[1] - a[1]) / (seg || 1);
      return { p: [a[0] + dx * seg * t, a[1] + dy * seg * t], normal: [dy, -dx] };
    }
    remaining -= seg;
  }
  const first = points[0] ?? [0, 0];
  return { p: first, normal: [1, 0] };
}

/**
 * Generates a plausible layout whose centreline length matches the hole's
 * playing length. Par 4s and 5s may dogleg; par 3s play straight-ish.
 */
export function generateHoleGeometry(rng: Rng, par: number, lengthM: number): HoleGeometry {
  const tee: Pt = [0, 0];
  let centerline: Pt[];

  if (par === 3) {
    const x = round1(rng.range(-12, 12));
    centerline = [tee, [x, round1(Math.sqrt(lengthM ** 2 - x ** 2))]];
  } else {
    const side = rng.next() < 0.5 ? -1 : 1;
    const bendAt = lengthM * rng.range(0.52, 0.64);
    const bendX = side * rng.range(0, par === 5 ? 35 : 28);
    const bend: Pt = [round1(bendX), round1(Math.sqrt(Math.max(1, bendAt ** 2 - bendX ** 2)))];
    const rest = lengthM - Math.hypot(bend[0], bend[1]);
    const greenDx = side * rng.range(5, rest * 0.35);
    const green: Pt = [round1(bend[0] + greenDx), round1(bend[1] + Math.sqrt(Math.max(1, rest ** 2 - greenDx ** 2)))];
    centerline = [tee, bend, green];
  }

  const greenCenter = centerline.at(-1) ?? tee;
  const greenRadius = round1(par === 3 ? rng.range(11, 15) : rng.range(13, 17));
  const hazards: HoleGeometry['hazards'] = [];

  // Greenside bunkers either side of the front.
  for (const s of [-1, 1]) {
    if (rng.next() < 0.75) {
      hazards.push({
        kind: 'bunker',
        center: [round1(greenCenter[0] + s * (greenRadius + rng.range(4, 8))), round1(greenCenter[1] - rng.range(0, 10))],
        radiusM: round1(rng.range(4, 7)),
      });
    }
  }
  // A fairway bunker in the landing zone on longer holes.
  if (par >= 4) {
    const { p, normal } = pointAlong(centerline, clamp(rng.range(200, 235), 0, lengthM - 80));
    const s = rng.next() < 0.5 ? -1 : 1;
    hazards.push({
      kind: 'bunker',
      center: [round1(p[0] + normal[0] * s * 20), round1(p[1] + normal[1] * s * 20)],
      radiusM: round1(rng.range(6, 10)),
    });
  }
  // Occasional water short of the green or along the fairway.
  if (rng.next() < 0.28) {
    const { p, normal } = pointAlong(centerline, lengthM * rng.range(0.55, 0.85));
    const s = rng.next() < 0.5 ? -1 : 1;
    hazards.push({
      kind: 'water',
      center: [round1(p[0] + normal[0] * s * 38), round1(p[1] + normal[1] * s * 38)],
      radiusM: round1(rng.range(14, 24)),
    });
  }

  return {
    tee: [0, 0],
    centerline: centerline.map(([x, y]) => [x, y] as [number, number]),
    fairwayWidthM: round1(par === 3 ? 22 : rng.range(28, 40)),
    green: { center: [greenCenter[0], greenCenter[1]], radiusM: greenRadius },
    hazards,
    greenElevationM: round1(rng.range(-8, 8)),
  };
}
