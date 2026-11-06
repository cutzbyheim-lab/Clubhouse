import { pointInPoly, type LatLon, type P } from './geo';
import type { Raster } from './tiles';

/*
 * Checks mapped outlines against an aerial photo.
 *
 * Bunkers (pale sand) and water (dark) are the features a photo identifies
 * most reliably, so they drive both alignment and the verdict. Greens and
 * fairways are checked as "turf" (green-dominant pixels), a weaker signal used
 * only when a hole has no bunkers or water.
 *
 * Classification is a deliberately simple colour rule. It is a check, not
 * ground truth, and the UI says so.
 */

export type PixelClass = 'sand' | 'water' | 'turf' | 'other';

export function classify([r, g, b]: [number, number, number]): PixelClass {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  if (v > 0.55 && s < 0.42 && r >= g * 0.92 && g >= b && r - b > 14) return 'sand'; // tan sand
  if (v > 0.66 && s < 0.18) return 'sand'; // white or grey sand, bright and colourless
  if (v < 0.45 && b >= r && b >= g * 0.8) return 'water';
  if (g > r * 1.04 && g > b * 1.04) return 'turf';
  return 'other';
}

/** Grid of points inside a polygon, spacing adapted so no polygon contributes more than `max`. */
export function interiorPoints(poly: readonly P[], max = 60): P[] {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let step = Math.max(1, Math.sqrt(((maxX - minX) * (maxY - minY)) / (max * 1.6)));
  for (let attempt = 0; attempt < 6; attempt++) {
    const out: P[] = [];
    for (let x = minX + step / 2; x < maxX; x += step) {
      for (let y = minY + step / 2; y < maxY; y += step) if (pointInPoly([x, y], poly)) out.push([x, y]);
    }
    if (out.length >= Math.min(8, max) || step <= 1) return out.slice(0, max);
    step /= 1.6;
  }
  return [];
}

export interface Probe {
  points: P[];
  expect: PixelClass;
}

/** Share of probe points (shifted by `shift`) whose photo pixel matches what the map says is there. */
export function agreement(probes: readonly Probe[], shift: P, photo: Raster, unproject: (p: P) => LatLon): { score: number; seen: number } {
  let hit = 0;
  let seen = 0;
  for (const probe of probes) {
    for (const [x, y] of probe.points) {
      const ll = unproject([x + shift[0], y + shift[1]]);
      const px = photo.rgb(ll.lat, ll.lon);
      if (!px) continue;
      seen++;
      if (classify(px) === probe.expect) hit++;
    }
  }
  return { score: seen ? hit / seen : 0, seen };
}

const SEARCH_M = 16;
const MIN_GAIN = 0.1;

/**
 * Finds the shift (metres east, north) that best lines bunkers and water up
 * with the photo. Returns null if no shift is clearly better than none.
 */
export function findShift(probes: readonly Probe[], photo: Raster, unproject: (p: P) => LatLon): { shift: P | null; before: number; after: number } {
  const base = agreement(probes, [0, 0], photo, unproject);
  if (base.seen < 30) return { shift: null, before: base.score, after: base.score };
  let best = { shift: [0, 0] as P, score: base.score };
  const scan = (cx: number, cy: number, radius: number, step: number) => {
    for (let dx = -radius; dx <= radius; dx += step) {
      for (let dy = -radius; dy <= radius; dy += step) {
        const s = agreement(probes, [cx + dx, cy + dy], photo, unproject).score;
        if (s > best.score + 1e-9) best = { shift: [cx + dx, cy + dy], score: s };
      }
    }
  };
  scan(0, 0, SEARCH_M, 2);
  scan(best.shift[0], best.shift[1], 2, 1);
  const gain = best.score - base.score;
  const moved = Math.hypot(best.shift[0], best.shift[1]) >= 1.5;
  return gain >= MIN_GAIN && moved ? { shift: best.shift, before: base.score, after: best.score } : { shift: null, before: base.score, after: base.score };
}

export interface HoleCheck {
  verdict: 'match' | 'partial' | 'mismatch' | 'unchecked';
  detail: string;
}

/** Grades one hole's mapped features against the photo. */
export function checkHole(
  features: { bunkers: P[][]; water: P[][]; greens: P[][] },
  photo: Raster | null,
  unproject: (p: P) => LatLon,
): HoleCheck {
  if (!photo) return { verdict: 'unchecked', detail: 'No aerial photo is available for this area.' };
  const parts: { label: string; probes: Probe[] }[] = [
    { label: 'bunkers', probes: features.bunkers.map((b) => ({ points: interiorPoints(b, 30), expect: 'sand' as const })) },
    { label: 'water', probes: features.water.map((w) => ({ points: interiorPoints(w, 40), expect: 'water' as const })) },
  ].filter((p) => p.probes.length > 0);

  if (parts.length === 0) {
    const greens = features.greens.map((g) => ({ points: interiorPoints(g, 40), expect: 'turf' as const }));
    const r = agreement(greens, [0, 0], photo, unproject);
    if (r.seen < 10) return { verdict: 'unchecked', detail: 'Nothing on this hole that a photo can confirm.' };
    return r.score >= 0.6
      ? { verdict: 'match', detail: 'The green sits on turf in the aerial photo. No bunkers or water to check.' }
      : { verdict: 'partial', detail: "The green outline doesn't sit cleanly on turf in the photo." };
  }

  const results = parts.map((p) => ({ label: p.label, ...agreement(p.probes, [0, 0], photo, unproject) })).filter((r) => r.seen >= 5);
  if (results.length === 0) return { verdict: 'unchecked', detail: 'The aerial photo doesn\'t cover this hole.' };
  const score = results.reduce((s, r) => s + r.score * r.seen, 0) / results.reduce((s, r) => s + r.seen, 0);
  const describe = results.map((r) => `${r.label} ${Math.round(r.score * 100)}%`).join(', ');
  if (score >= 0.45) return { verdict: 'match', detail: `Mapped features line up with the aerial photo (${describe} agreement).` };
  if (score >= 0.22) return { verdict: 'partial', detail: `Some mapped features don't line up with the photo (${describe} agreement).` };
  return { verdict: 'mismatch', detail: `The mapped features don't match the aerial photo here (${describe} agreement). The map may be out of date.` };
}
