import type { CoursePreview, OsmRef, PreviewHole } from '@shared/dto';
import { HoleGeometry } from '@shared/schemas';
import { area, centroid, dist, distToLine, distToPoly, lineLength, open, pointInPoly, projector, simplifyTo, type LatLon, type P } from './geo';
import type { GolfFeatures } from './parse';

export const OSM_ATTRIBUTION = 'Layout © OpenStreetMap contributors (ODbL)';

const GREEN_NEAR_END_M = 60;
const TEE_NEAR_START_M = 40;
const FAIRWAY_NEAR_M = 50;
const BUNKER_NEAR_M = 45;
const WATER_NEAR_M = 60;
const TREE_NEAR_M = 90;
const WOOD_SAMPLE_M = 14;
const LIMITS = { greens: 4, tees: 12, fairways: 12, bunkers: 40, water: 12, trees: 400, hazards: 16 } as const;

const round1 = (v: number) => Math.round(v * 10) / 10;
const r1 = (p: P): [number, number] => [round1(p[0]), round1(p[1])];

interface Projected {
  key: string;
  ref: number | null;
  par: number | null;
  handicap: number | null;
  line: P[];
}

/** Turns map features into a preview the player can check and complete before importing. */
export function buildPreview(features: GolfFeatures, meta: { osm: OsmRef; name: string; place: string }): CoursePreview {
  const notes: string[] = [];
  const all = features.holes.flatMap((h) => h.line);
  if (all.length === 0) {
    return {
      ...meta,
      holes: [],
      overview: { holes: [], greens: [], bunkers: [], water: [], fairways: [] },
      notes: ['No holes are mapped for this course on OpenStreetMap yet. You can still add it by hand from the scorecard.'],
      attribution: OSM_ATTRIBUTION,
    };
  }

  const origin: LatLon = { lat: all.reduce((s, p) => s + p.lat, 0) / all.length, lon: all.reduce((s, p) => s + p.lon, 0) / all.length };
  const proj = projector(origin);
  const polys = (list: LatLon[][]) => list.map((g) => open(g.map(proj))).filter((p) => p.length >= 3);
  const greens = polys(features.greens);
  const tees = polys(features.tees);
  const fairways = polys(features.fairways);
  const bunkers = polys(features.bunkers);
  const water = polys(features.water);
  const woods = polys(features.woods);
  const trees = features.trees.map(proj);

  // Holes, oriented tee → green (mappers occasionally draw them backwards).
  const holes: Projected[] = features.holes
    .map((h) => {
      let line = h.line.map(proj);
      if (greens.length > 0) {
        const near = (p: P) => Math.min(...greens.map((g) => distToPoly(p, g)));
        if (near(line[0]!) < near(line[line.length - 1]!)) line = [...line].reverse();
      }
      return { key: `w${h.osmId}`, ref: h.ref, par: h.par, handicap: h.handicap, line };
    })
    .sort((a, b) => (a.ref ?? 99) - (b.ref ?? 99) || a.key.localeCompare(b.key));

  // Each fairway and bunker belongs to the hole whose line it sits closest to.
  const owner = (p: P, maxM: number): string | null => {
    let best: { key: string; d: number } | null = null;
    for (const h of holes) {
      const d = distToLine(p, h.line);
      if (d <= maxM && (!best || d < best.d)) best = { key: h.key, d };
    }
    return best?.key ?? null;
  };
  const fairwayOwner = fairways.map((f) => owner(centroid(f), FAIRWAY_NEAR_M));
  const bunkerOwner = bunkers.map((b) => owner(centroid(b), BUNKER_NEAR_M));

  const previewHoles: PreviewHole[] = [];
  for (const h of holes) {
    const start = h.line[0]!;
    const end = h.line[h.line.length - 1]!;
    const len = dist(start, end) || 1;
    const d: P = [(end[0] - start[0]) / len, (end[1] - start[1]) / len];
    const r: P = [d[1], -d[0]]; // player's right when facing the green
    const toFrame = (p: P): [number, number] => {
      const v: P = [p[0] - start[0], p[1] - start[1]];
      return r1([v[0] * r[0] + v[1] * r[1], v[0] * d[0] + v[1] * d[1]]);
    };
    const framePoly = (poly: P[]) => simplifyTo(poly.map(toFrame), 160, 0.4).map(r1);

    const green = greens
      .map((g) => ({ g, d: distToPoly(end, g) }))
      .filter((x) => x.d <= GREEN_NEAR_END_M)
      .sort((a, b) => a.d - b.d)[0]?.g;
    const holeTees = tees.filter((t) => distToPoly(start, t) <= TEE_NEAR_START_M).slice(0, LIMITS.tees);
    const holeFairways = fairways.filter((_, i) => fairwayOwner[i] === h.key).slice(0, LIMITS.fairways);
    const holeBunkers = bunkers.filter((_, i) => bunkerOwner[i] === h.key).sort((a, b) => area(b) - area(a)).slice(0, LIMITS.bunkers);
    const holeWater = water.filter((w) => w.some((p) => distToLine(p, h.line) <= WATER_NEAR_M) || h.line.some((p) => pointInPoly(p, w))).slice(0, LIMITS.water);

    // Trees: mapped single trees plus a grid sampled inside mapped woods, near the line of play.
    const treePts: [number, number][] = trees.filter((t) => distToLine(t, h.line) <= TREE_NEAR_M).map(toFrame);
    for (const wood of woods) {
      if (!wood.some((p) => distToLine(p, h.line) <= TREE_NEAR_M * 1.5)) continue;
      const xs = wood.map((p) => p[0]);
      const ys = wood.map((p) => p[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += WOOD_SAMPLE_M) {
        for (let y = Math.min(...ys); y <= Math.max(...ys); y += WOOD_SAMPLE_M) {
          const p: P = [x, y];
          if (treePts.length < LIMITS.trees && pointInPoly(p, wood) && distToLine(p, h.line) <= TREE_NEAR_M) treePts.push(toFrame(p));
        }
      }
    }

    const greenC = green ? toFrame(centroid(green)) : toFrame(end);
    const greenR = green ? Math.min(30, Math.max(5, Math.sqrt(area(green) / Math.PI))) : 12;
    const fwArea = holeFairways.reduce((s, f) => s + area(f), 0);
    const fwAlong = holeFairways.reduce((s, f) => {
      const ys = f.map((p) => toFrame(p)[1]);
      return s + Math.max(1, Math.max(...ys) - Math.min(...ys));
    }, 0);
    const fairwayWidth = holeFairways.length ? Math.min(60, Math.max(18, fwArea / fwAlong)) : 30;
    const hazards = [
      ...holeBunkers.map((b) => ({ kind: 'bunker' as const, poly: b })),
      ...holeWater.map((w) => ({ kind: 'water' as const, poly: w })),
    ]
      .map(({ kind, poly }) => ({ kind, center: toFrame(centroid(poly)), radiusM: round1(Math.min(80, Math.max(2, Math.sqrt(area(poly) / Math.PI)))) }))
      .slice(0, LIMITS.hazards);

    const centerline = simplifyTo(h.line.map(toFrame), 8, 1).map(r1);
    centerline[0] = [0, 0];

    const parsed = HoleGeometry.safeParse({
      tee: [0, 0],
      centerline,
      fairwayWidthM: round1(fairwayWidth),
      green: { center: greenC, radiusM: round1(greenR) },
      hazards,
      greenElevationM: 0,
      source: 'map',
      outlines: {
        greens: green ? [framePoly(green)] : [],
        tees: holeTees.map(framePoly),
        fairways: holeFairways.map(framePoly),
        bunkers: holeBunkers.map(framePoly),
        water: holeWater.map(framePoly),
      },
      trees: treePts.slice(0, LIMITS.trees),
    });
    if (!parsed.success) {
      notes.push(`Hole ${h.ref ?? '?'} has map data Clubhouse couldn't read, so it was skipped.`);
      continue;
    }
    const lengthM = lineLength(h.line);
    previewHoles.push({
      key: h.key,
      number: h.ref !== null && h.ref <= 18 ? h.ref : null,
      par: h.par,
      strokeIndex: h.handicap,
      lengthM: lengthM >= 50 && lengthM <= 750 ? round1(lengthM) : null,
      geometry: parsed.data,
      has: { green: !!green, tee: holeTees.length > 0, fairway: holeFairways.length > 0, bunkers: holeBunkers.length, water: holeWater.length },
    });
  }

  // What the player needs to know before importing.
  const n = previewHoles.length;
  if (n !== 9 && n !== 18) notes.push(`${n} holes are mapped. Choose 9 or 18 to import${n > 18 ? ' (this facility may have more than one course)' : ''}.`);
  const refs = previewHoles.map((h) => h.number).filter((x): x is number => x !== null);
  if (new Set(refs).size !== refs.length) notes.push('Some hole numbers appear more than once. Untick the holes that belong to another course.');
  const noPar = previewHoles.filter((h) => h.par === null).length;
  if (noPar > 0) notes.push(`Par is missing on ${noPar} hole${noPar === 1 ? '' : 's'}; fill it in from the scorecard.`);
  const noNum = previewHoles.filter((h) => h.number === null).length;
  if (noNum > 0) notes.push(`${noNum} hole${noNum === 1 ? ' has' : 's have'} no number on the map; set them before importing.`);
  const noGreen = previewHoles.filter((h) => !h.has.green).length;
  if (noGreen > 0) notes.push(`${noGreen} green${noGreen === 1 ? ' isn\'t' : 's aren\'t'} mapped; the 3D view marks those with a plain circle.`);

  const ov = (list: P[][], max: number) => list.slice(0, max).map((p) => simplifyTo(p, 40, 1).map(r1));
  return {
    ...meta,
    holes: previewHoles,
    overview: {
      holes: holes.map((h) => ({ key: h.key, line: simplifyTo(h.line, 12, 2).map(r1) })),
      greens: ov(greens, 60),
      bunkers: ov(bunkers, 300),
      water: ov(water, 40),
      fairways: ov(fairways, 60),
    },
    notes,
    attribution: OSM_ATTRIBUTION,
  };
}
