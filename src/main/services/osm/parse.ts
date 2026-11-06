import type { LatLon } from './geo';

/*
 * Reads an Overpass API `out geom` response into golf features, following the
 * OpenStreetMap golf tagging scheme (https://wiki.openstreetmap.org/wiki/Key:golf):
 *
 *   golf=hole   way drawn from tee to green; ref = hole number, par, handicap = stroke index
 *   golf=green / tee / fairway / bunker / water_hazard / lateral_water_hazard   areas
 *   golf=pin    node
 *   natural=water, natural=wood, landuse=forest   areas;  natural=tree   node
 */

type Tags = Record<string, string>;

interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}
interface OsmWay {
  type: 'way';
  id: number;
  geometry?: LatLon[];
  tags?: Tags;
}
interface OsmRelation {
  type: 'relation';
  id: number;
  members?: { type: string; role: string; geometry?: LatLon[] }[];
  tags?: Tags;
}
type Element = OsmNode | OsmWay | OsmRelation;

export interface RawHole {
  osmId: number;
  ref: number | null;
  par: number | null;
  handicap: number | null;
  line: LatLon[];
}

export interface GolfFeatures {
  holes: RawHole[];
  greens: LatLon[][];
  tees: LatLon[][];
  fairways: LatLon[][];
  bunkers: LatLon[][];
  water: LatLon[][];
  woods: LatLon[][];
  trees: LatLon[];
  pins: LatLon[];
}

/** First integer in a tag value ("4", "4;5", " 12 ") or null. */
function int(v: string | undefined, min: number, max: number): number | null {
  if (!v) return null;
  const m = /\d+/.exec(v);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= min && n <= max ? n : null;
}

const isClosed = (g: LatLon[]) => {
  const a = g[0];
  const b = g[g.length - 1];
  return g.length >= 4 && !!a && !!b && a.lat === b.lat && a.lon === b.lon;
};

/** Outer rings of a way (if closed) or multipolygon relation. */
function rings(el: OsmWay | OsmRelation): LatLon[][] {
  if (el.type === 'way') return el.geometry && isClosed(el.geometry) ? [el.geometry] : [];
  return (el.members ?? [])
    .filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry && isClosed(m.geometry))
    .map((m) => m.geometry as LatLon[]);
}

export function parseOverpass(json: unknown): GolfFeatures {
  const out: GolfFeatures = { holes: [], greens: [], tees: [], fairways: [], bunkers: [], water: [], woods: [], trees: [], pins: [] };
  const elements = (json as { elements?: Element[] })?.elements;
  if (!Array.isArray(elements)) throw new Error('The map service sent an unexpected response');

  for (const el of elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t['golf'] === 'pin') out.pins.push({ lat: el.lat, lon: el.lon });
      else if (t['natural'] === 'tree') out.trees.push({ lat: el.lat, lon: el.lon });
      continue;
    }
    const golf = t['golf'];
    if (golf === 'hole' && el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      out.holes.push({
        osmId: el.id,
        ref: int(t['ref'], 1, 36),
        par: int(t['par'], 3, 6),
        handicap: int(t['handicap'] ?? t['hcp'], 1, 18),
        line: el.geometry,
      });
      continue;
    }
    const polys = rings(el);
    if (polys.length === 0) continue;
    if (golf === 'green') out.greens.push(...polys);
    else if (golf === 'tee') out.tees.push(...polys);
    else if (golf === 'fairway') out.fairways.push(...polys);
    else if (golf === 'bunker') out.bunkers.push(...polys);
    else if (golf === 'water_hazard' || golf === 'lateral_water_hazard' || t['natural'] === 'water') out.water.push(...polys);
    else if (t['natural'] === 'wood' || t['landuse'] === 'forest') out.woods.push(...polys);
  }
  return out;
}

/** Overpass QL for every golf feature (plus water and trees) inside a bounding box. */
export function overpassQuery([s, w, n, e]: readonly [number, number, number, number]): string {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:45];
(
  way["golf"]${b};
  relation["golf"]${b};
  node["golf"="pin"]${b};
  way["natural"="water"]${b};
  relation["natural"="water"]${b};
  way["natural"="wood"]${b};
  way["landuse"="forest"]${b};
  node["natural"="tree"]${b};
);
out geom;`;
}
