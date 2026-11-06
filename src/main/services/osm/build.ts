import type { CoursePreview, OsmRef, PreviewHole } from '@shared/dto';
import { HoleGeometry } from '@shared/schemas';
import { area, centroid, dist, distToLine, distToPoly, lineLength, open, pointInPoly, projector, simplifyTo, unprojector, type LatLon, type P } from './geo';
import type { GolfFeatures } from './parse';
import { checkHole, findShift, interiorPoints, type Probe } from './photoCheck';
import { ELEVATION, IMAGERY, encodeJpeg, terrariumHeight, type Raster } from './tiles';
import { detectTrees, type DetectedTree } from './treeDetect';

export const OSM_ATTRIBUTION = 'Layout © OpenStreetMap contributors (ODbL)';

const GREEN_NEAR_END_M = 60;
const TEE_NEAR_START_M = 40;
const FAIRWAY_NEAR_M = 50;
const BUNKER_NEAR_M = 45;
const WATER_NEAR_M = 60;
const TREE_NEAR_M = 90;
const WOOD_SAMPLE_M = 14;
const FRAME_MARGIN_M = 45;
const MAX_GRID_POINTS = 15_000;
const LIMITS = { greens: 4, tees: 12, fairways: 12, bunkers: 40, water: 12, trees: 400, hazards: 16 } as const;

const round1 = (v: number) => Math.round(v * 10) / 10;
const r1 = (p: P): [number, number] => [round1(p[0]), round1(p[1])];

export interface HoleImage {
  jpeg: Buffer;
  width: number;
  height: number;
  bounds: [number, number, number, number];
}

export interface BuildEnv {
  /** Aerial photo raster covering the course, if available. */
  photo: Raster | null;
  /** Terrarium elevation raster covering the course, if available. */
  elevation: Raster | null;
}

export interface BuildResult {
  preview: CoursePreview;
  /** Per-hole aerial photo in the hole frame, keyed like PreviewHole.key. Kept in the main process. */
  images: Map<string, HoleImage>;
}

interface Projected {
  key: string;
  ref: number | null;
  par: number | null;
  handicap: number | null;
  line: P[];
}

/** Renders a photo of a rectangle of ground into RGBA; null if the photo doesn't cover enough of it. */
function renderPhoto(photo: Raster, width: number, height: number, at: (col: number, row: number) => LatLon): Uint8Array | null {
  const rgba = new Uint8Array(width * height * 4);
  let missing = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ll = at(col + 0.5, row + 0.5);
      const px = photo.rgb(ll.lat, ll.lon);
      const i = (row * width + col) * 4;
      if (px) {
        rgba[i] = px[0];
        rgba[i + 1] = px[1];
        rgba[i + 2] = px[2];
      } else {
        missing++;
        rgba[i] = 28;
        rgba[i + 1] = 31;
        rgba[i + 2] = 29;
      }
      rgba[i + 3] = 255;
    }
  }
  return missing / (width * height) > 0.3 ? null : rgba;
}

/** Turns map features into a preview the player can check and complete before importing. */
export function buildPreview(features: GolfFeatures, meta: { osm: OsmRef; name: string; place: string }, env: BuildEnv = { photo: null, elevation: null }): BuildResult {
  const notes: string[] = [];
  const images = new Map<string, HoleImage>();
  const credits = [OSM_ATTRIBUTION];
  const all = features.holes.flatMap((h) => h.line);
  if (all.length === 0) {
    return {
      images,
      preview: {
        ...meta,
        holes: [],
        overview: { holes: [], greens: [], bunkers: [], water: [], fairways: [] },
        notes: ['No holes are mapped for this course on OpenStreetMap yet. You can still add it by hand from the scorecard.'],
        attribution: OSM_ATTRIBUTION,
        photo: null,
        photoCheck: { available: false, shiftM: null, summary: 'Nothing to check.' },
        terrain: { available: false, reliefM: null },
        credits,
      },
    };
  }

  const origin: LatLon = { lat: all.reduce((s, p) => s + p.lat, 0) / all.length, lon: all.reduce((s, p) => s + p.lon, 0) / all.length };
  const proj = projector(origin);
  const unproj = unprojector(origin);
  const polys = (list: LatLon[][]) => list.map((g) => open(g.map(proj))).filter((p) => p.length >= 3);
  let greens = polys(features.greens);
  let tees = polys(features.tees);
  let fairways = polys(features.fairways);
  let bunkers = polys(features.bunkers);
  let water = polys(features.water);
  let woods = polys(features.woods);
  let trees = features.trees.map(proj);
  let holeLines = features.holes.map((h) => h.line.map(proj));

  // ── Line the map up with the aerial photo, if one is available.
  let shiftM: [number, number] | null = null;
  if (env.photo) {
    const probes: Probe[] = [
      ...bunkers.map((b) => ({ points: interiorPoints(b, 30), expect: 'sand' as const })),
      ...water.map((w) => ({ points: interiorPoints(w, 40), expect: 'water' as const })),
    ];
    const found = findShift(probes, env.photo, unproj);
    if (found.shift) {
      const [sx, sy] = found.shift;
      shiftM = [round1(sx), round1(sy)];
      const mv = (p: P): P => [p[0] + sx, p[1] + sy];
      const mvAll = (list: P[][]) => list.map((poly) => poly.map(mv));
      greens = mvAll(greens);
      tees = mvAll(tees);
      fairways = mvAll(fairways);
      bunkers = mvAll(bunkers);
      water = mvAll(water);
      woods = mvAll(woods);
      trees = trees.map(mv);
      holeLines = holeLines.map((l) => l.map(mv));
    }
  }

  // Holes, oriented tee → green (mappers occasionally draw them backwards).
  const holes: Projected[] = features.holes
    .map((h, i) => {
      let line = holeLines[i]!;
      if (greens.length > 0) {
        const near = (p: P) => Math.min(...greens.map((g) => distToPoly(p, g)));
        if (near(line[0]!) < near(line[line.length - 1]!)) line = [...line].reverse();
      }
      return { key: `w${h.osmId}`, ref: h.ref, par: h.par, handicap: h.handicap, line };
    })
    .sort((a, b) => (a.ref ?? 99) - (b.ref ?? 99) || a.key.localeCompare(b.key));

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

  const elevationAt = (p: P): number | null => {
    if (!env.elevation) return null;
    const ll = unproj(p);
    const h = env.elevation.scalar(ll.lat, ll.lon, terrariumHeight);
    return h !== null && Number.isFinite(h) && h > -500 && h < 9000 ? h : null;
  };

  const treeCells = new Map<string, P[]>();

  let reliefMin = Infinity;
  let reliefMax = -Infinity;
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
    const fromFrame = ([x, y]: readonly [number, number]): P => [start[0] + x * r[0] + y * d[0], start[1] + x * r[1] + y * d[1]];
    const framePoly = (poly: P[]) => simplifyTo(poly.map(toFrame), 160, 0.4).map(r1);

    const green = greens
      .map((g) => ({ g, d: distToPoly(end, g) }))
      .filter((x) => x.d <= GREEN_NEAR_END_M)
      .sort((a, b) => a.d - b.d)[0]?.g;
    const holeTees = tees.filter((t) => distToPoly(start, t) <= TEE_NEAR_START_M).slice(0, LIMITS.tees);
    const holeFairways = fairways.filter((_, i) => fairwayOwner[i] === h.key).slice(0, LIMITS.fairways);
    const holeBunkers = bunkers.filter((_, i) => bunkerOwner[i] === h.key).sort((a, b) => area(b) - area(a)).slice(0, LIMITS.bunkers);
    const holeWater = water.filter((w) => w.some((p) => distToLine(p, h.line) <= WATER_NEAR_M) || h.line.some((p) => pointInPoly(p, w))).slice(0, LIMITS.water);

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
    const outlines = {
      greens: green ? [framePoly(green)] : [],
      tees: holeTees.map(framePoly),
      fairways: holeFairways.map(framePoly),
      bunkers: holeBunkers.map(framePoly),
      water: holeWater.map(framePoly),
    };

    // Frame rectangle covering everything on the hole, shared by terrain and photo so they line up.
    const framePts = [...centerline, ...Object.values(outlines).flat(2) as unknown as [number, number][], greenC];
    const fx = framePts.map((p) => p[0]);
    const fy = framePts.map((p) => p[1]);
    const bx0 = Math.floor(Math.min(...fx) - FRAME_MARGIN_M);
    const by0 = Math.floor(Math.min(...fy) - FRAME_MARGIN_M);
    const bx1 = Math.ceil(Math.max(...fx) + FRAME_MARGIN_M);
    const by1 = Math.ceil(Math.max(...fy) + FRAME_MARGIN_M);

    // ── Measured terrain, relative to the tee.
    let elevation: HoleGeometry['elevation'];
    let greenElevationM = 0;
    const teeHeight = elevationAt(start);
    if (teeHeight !== null) {
      const step = Math.max(4, Math.ceil(Math.sqrt(((bx1 - bx0) * (by1 - by0)) / MAX_GRID_POINTS)));
      const cols = Math.min(400, Math.floor((bx1 - bx0) / step) + 1);
      const rows = Math.min(400, Math.floor((by1 - by0) / step) + 1);
      const heights: number[] = [];
      let missing = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const hgt = elevationAt(fromFrame([bx0 + col * step, by0 + row * step]));
          if (hgt === null) missing++;
          heights.push(hgt === null ? 0 : round1(hgt - teeHeight));
        }
      }
      if (missing / heights.length < 0.15) {
        elevation = { x0: bx0, y0: by0, stepM: step, cols, rows, heights, source: ELEVATION.credit };
        for (const v of heights) {
          reliefMin = Math.min(reliefMin, v + teeHeight);
          reliefMax = Math.max(reliefMax, v + teeHeight);
        }
        const gh = elevationAt(fromFrame(greenC));
        if (gh !== null) greenElevationM = Math.max(-40, Math.min(40, round1(gh - teeHeight)));
      }
    }

    // ── Aerial photo of the hole, rotated into the hole frame (row 0 = far end).
    let imageryBounds: [number, number, number, number] | undefined;
    let photoTrees: DetectedTree[] | undefined;
    if (env.photo) {
      const w = bx1 - bx0;
      const hgt = by1 - by0;
      const mpp = Math.max(0.6, Math.max(w, hgt) / 1600);
      const width = Math.max(16, Math.min(4096, Math.round(w / mpp)));
      const height = Math.max(16, Math.min(4096, Math.round(hgt / mpp)));
      const photo = env.photo;
      const rgba = renderPhoto(photo, width, height, (col, row) => unproj(fromFrame([bx0 + (col / width) * w, by1 - (row / height) * hgt])));
      if (rgba) {
        imageryBounds = [bx0, by0, bx1, by1];
        images.set(h.key, { jpeg: encodeJpeg(width, height, rgba), width, height, bounds: imageryBounds });
        photoTrees = treesFromPhoto(rgba, width, height, imageryBounds, outlines, centerline);
        // Neighbouring holes' photos overlap, so count each tree once across the course.
        for (const t of photoTrees) {
          const [gx, gy] = fromFrame([t[0], t[1]]);
          const cx = Math.floor(gx / 6), cy = Math.floor(gy / 6);
          let seen = false;
          for (let i = -1; i <= 1 && !seen; i++)
            for (let j = -1; j <= 1 && !seen; j++)
              seen = (treeCells.get(`${cx + i},${cy + j}`) ?? []).some(([px, py]) => Math.hypot(px - gx, py - gy) < Math.max(3, t[2]));
          if (!seen) treeCells.set(`${cx},${cy}`, [...(treeCells.get(`${cx},${cy}`) ?? []), [gx, gy]]);
        }
      }
    }

    const check = checkHole({ bunkers: holeBunkers, water: holeWater, greens: green ? [green] : [] }, env.photo, unproj);

    const parsed = HoleGeometry.safeParse({
      tee: [0, 0],
      centerline,
      fairwayWidthM: round1(fairwayWidth),
      green: { center: greenC, radiusM: round1(greenR) },
      hazards,
      greenElevationM,
      source: 'map',
      outlines,
      trees: treePts.slice(0, LIMITS.trees),
      ...(photoTrees ? { photoTrees } : {}),
      ...(elevation ? { elevation } : {}),
      ...(imageryBounds ? { imageryBounds } : {}),
      check,
    });
    if (!parsed.success) {
      notes.push(`Hole ${h.ref ?? '?'} has map data Clubhouse couldn't read, so it was skipped.`);
      images.delete(h.key);
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

  // ── What the player needs to know before importing.
  const n = previewHoles.length;
  if (n !== 9 && n !== 18) notes.push(`${n} holes are mapped. Choose 9 or 18 to import${n > 18 ? ' (this facility may have more than one course)' : ''}.`);
  const refs = previewHoles.map((h) => h.number).filter((x): x is number => x !== null);
  if (new Set(refs).size !== refs.length) notes.push('Some hole numbers appear more than once. Untick the holes that belong to another course.');
  const noPar = previewHoles.filter((h) => h.par === null).length;
  if (noPar > 0) notes.push(`Par is missing on ${noPar} hole${noPar === 1 ? '' : 's'}; fill it in from the scorecard.`);
  const noNum = previewHoles.filter((h) => h.number === null).length;
  if (noNum > 0) notes.push(`${noNum} hole${noNum === 1 ? ' has' : 's have'} no number on the map; set them before importing.`);
  const noGreen = previewHoles.filter((h) => !h.has.green).length;
  if (noGreen > 0) notes.push(`${noGreen} green${noGreen === 1 ? " isn't" : "s aren't"} mapped; the 3D view marks those with a plain circle.`);

  // ── Photo check summary.
  const verdicts = previewHoles.map((h) => h.geometry.check?.verdict ?? 'unchecked');
  const count = (v: string) => verdicts.filter((x) => x === v).length;
  let summary: string;
  if (!env.photo) summary = 'No aerial photo is available for this area, so the map could not be checked against one.';
  else {
    const checked = n - count('unchecked');
    summary = `Checked against the aerial photo: ${count('match')} of ${checked} hole${checked === 1 ? '' : 's'} line up`;
    if (count('partial')) summary += `, ${count('partial')} partly`;
    if (count('mismatch')) summary += `, ${count('mismatch')} don't match`;
    summary += '.';
    if (shiftM) summary += ` The map was ${Math.round(Math.hypot(shiftM[0], shiftM[1]))} m off the photo and has been moved to line up.`;
    const treeCount = [...treeCells.values()].reduce((n, l) => n + l.length, 0);
    if (treeCount > 0) summary += ` Found about ${treeCount.toLocaleString('en-US')} trees in the photo.`;
    credits.push(IMAGERY.credit);
  }
  const terrainAvailable = previewHoles.some((h) => h.geometry.elevation);
  if (terrainAvailable) credits.push(ELEVATION.credit);

  // ── Course-wide photo for the preview map (north up, in overview metres).
  const ovPts = [...holes.flatMap((h) => h.line), ...greens.flat(), ...fairways.flat()];
  let photo: CoursePreview['photo'] = null;
  if (env.photo && ovPts.length) {
    const minX = Math.min(...ovPts.map((p) => p[0])) - 30;
    const maxX = Math.max(...ovPts.map((p) => p[0])) + 30;
    const minY = Math.min(...ovPts.map((p) => p[1])) - 30;
    const maxY = Math.max(...ovPts.map((p) => p[1])) + 30;
    const mpp = Math.max(1, Math.max(maxX - minX, maxY - minY) / 1200);
    const width = Math.round((maxX - minX) / mpp);
    const height = Math.round((maxY - minY) / mpp);
    const source = env.photo;
    const rgba = renderPhoto(source, width, height, (col, row) => unproj([minX + (col / width) * (maxX - minX), maxY - (row / height) * (maxY - minY)]));
    if (rgba) photo = { dataUrl: `data:image/jpeg;base64,${encodeJpeg(width, height, rgba, 78).toString('base64')}`, bounds: [minX, minY, maxX, maxY] };
  }

  const ov = (list: P[][], max: number) => list.slice(0, max).map((p) => simplifyTo(p, 40, 1).map(r1));
  return {
    images,
    preview: {
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
      photo,
      photoCheck: { available: !!env.photo, shiftM, summary },
      terrain: { available: terrainAvailable, reliefM: terrainAvailable ? round1(reliefMax - reliefMin) : null },
      credits,
    },
  };
}

/** Trees in a hole's photo, avoiding mapped features and judged against the hole's own turf. */
export function treesFromPhoto(
  rgba: Uint8Array,
  width: number,
  height: number,
  bounds: readonly [number, number, number, number],
  outlines: NonNullable<HoleGeometry['outlines']>,
  line: readonly (readonly [number, number])[],
): DetectedTree[] {
  const result = detectTrees({
    rgba,
    width,
    height,
    bounds,
    avoid: [...outlines.greens, ...outlines.tees, ...outlines.fairways, ...outlines.bunkers, ...outlines.water],
    turf: [...outlines.fairways, ...outlines.greens],
    line,
  });
  return result.reliable ? result.trees : [];
}
