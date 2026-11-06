import type { CourseImport, CoursePreview, CourseSearchResult, OsmRef } from '@shared/dto';
import type { DB } from '../db/connection';
import { DomainError } from '../errors';
import { OSM_ATTRIBUTION, buildPreview } from './osm/build';
import { NOMINATIM, OVERPASS, type Http } from './osm/client';
import { overpassQuery, parseOverpass } from './osm/parse';

const refString = (r: OsmRef) => `osm:${r.type}/${r.id}`;
const MAX_SPAN_DEG = 0.08; // ≈ 8 km: larger than any golf facility
const PAD_DEG = 0.0015; // ≈ 150 m, so holes poking past the boundary are included

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  display_name?: string;
  category?: string;
  class?: string;
  type?: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
}

function placeOf(r: NominatimResult): string {
  const a = r.address ?? {};
  const town = a['city'] ?? a['town'] ?? a['village'] ?? a['hamlet'] ?? a['suburb'] ?? a['county'];
  const parts = [town, a['state'] ?? a['region'], a['country']].filter((x): x is string => !!x);
  return parts.length ? parts.join(', ') : (r.display_name ?? '').split(',').slice(1, 4).join(',').trim();
}

export async function searchCourses(db: DB, http: Http, query: string): Promise<CourseSearchResult[]> {
  const imported = new Set(
    db.prepare<[], { external_ref: string }>('SELECT external_ref FROM course WHERE external_ref IS NOT NULL').all().map((r) => r.external_ref),
  );
  const run = async (q: string) => {
    const url = `${NOMINATIM}?${new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '15' })}`;
    const json = await http.getJson(url, 20_000);
    return Array.isArray(json) ? (json as NominatimResult[]) : [];
  };
  const isCourse = (r: NominatimResult) => (r.category ?? r.class) === 'leisure' && r.type === 'golf_course';
  let found = (await run(query)).filter(isCourse);
  if (found.length === 0 && !/golf/i.test(query)) found = (await run(`${query} golf`)).filter(isCourse);

  const out: CourseSearchResult[] = [];
  for (const r of found) {
    const type = r.osm_type;
    if ((type !== 'way' && type !== 'relation' && type !== 'node') || !r.osm_id || !r.boundingbox) continue;
    const [s, n, w, e] = r.boundingbox.map(Number) as [number, number, number, number];
    if (![s, n, w, e].every(Number.isFinite)) continue;
    const osm = { type, id: r.osm_id } as const;
    out.push({
      osm,
      name: r.name || (r.display_name ?? 'Golf course').split(',')[0]!,
      place: placeOf(r),
      bbox: [s, w, n, e],
      alreadyImported: imported.has(refString(osm)),
    });
  }
  return out.slice(0, 10);
}

export async function previewCourse(http: Http, target: Omit<CourseSearchResult, 'alreadyImported'>): Promise<CoursePreview> {
  const [s, w, n, e] = target.bbox;
  if (n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) {
    throw new DomainError('VALIDATION', 'That result covers too large an area to be a single course.');
  }
  const query = overpassQuery([s - PAD_DEG, w - PAD_DEG, n + PAD_DEG, e + PAD_DEG]);
  let lastError: unknown = null;
  for (const endpoint of OVERPASS) {
    try {
      const json = await http.postForm(endpoint, { data: query }, 60_000);
      return buildPreview(parseOverpass(json), { osm: target.osm, name: target.name, place: target.place });
    } catch (err) {
      lastError = err; // try the next mirror
    }
  }
  throw lastError instanceof Error ? lastError : new DomainError('UNAVAILABLE', "Couldn't load that course's map data.");
}

/** Saves an imported course: one tee (lengths as confirmed by the player) and the real layout for each hole. */
export function importCourse(db: DB, input: CourseImport): number {
  const ref = refString(input.osm);
  if (db.prepare('SELECT 1 FROM course WHERE external_ref = ?').get(ref)) {
    throw new DomainError('CONFLICT', 'This course is already in your courses.');
  }
  return db.transaction(() => {
    const courseId = Number(
      db
        .prepare("INSERT INTO course (name, location, source, external_ref, attribution) VALUES (?, ?, 'imported', ?, ?)")
        .run(input.name, input.location, ref, OSM_ATTRIBUTION).lastInsertRowid,
    );
    const teeId = Number(
      db
        .prepare('INSERT INTO course_tee (course_id, name, course_rating, slope_rating) VALUES (?, ?, ?, ?)')
        .run(courseId, input.tee.name, input.tee.courseRating, input.tee.slopeRating).lastInsertRowid,
    );
    const insHole = db.prepare('INSERT INTO hole (course_id, number, par, stroke_index, geometry) VALUES (?, ?, ?, ?, ?)');
    const insLen = db.prepare('INSERT INTO hole_length (tee_id, hole_id, length_m) VALUES (?, ?, ?)');
    for (const h of [...input.holes].sort((a, b) => a.number - b.number)) {
      const holeId = Number(insHole.run(courseId, h.number, h.par, h.strokeIndex, JSON.stringify(h.geometry)).lastInsertRowid);
      if (h.lengthM !== null) insLen.run(teeId, holeId, h.lengthM);
    }
    return courseId;
  })();
}
