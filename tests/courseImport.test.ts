import { describe, expect, it } from 'vitest';
import { CourseImport, CoursePreview } from '@shared/dto';
import { DomainError } from '../src/main/errors';
import { importCourse, previewCourse, searchCourses } from '../src/main/services/courseImport';
import { buildPreview } from '../src/main/services/osm/build';
import { createHttp, type Http } from '../src/main/services/osm/client';
import { parseOverpass } from '../src/main/services/osm/parse';
import { getCourse } from '../src/main/db/repositories/courses';
import { freshDb } from './helpers';
import { nominatimFixture, osmCourseFixture } from './fixtures/osmCourse';

const meta = { osm: { type: 'way' as const, id: 4242 }, name: 'Test Links', place: 'Seattle, Washington' };
const preview = () => buildPreview(parseOverpass(osmCourseFixture()), meta).preview;

describe('parsing OpenStreetMap golf data', () => {
  it('reads holes and features and ignores everything else', () => {
    const f = parseOverpass(osmCourseFixture());
    expect(f.holes.map((h) => [h.ref, h.par, h.handicap])).toEqual([
      [1, 4, 5],
      [2, 3, 17],
      [3, null, 1],
    ]);
    expect(f.greens).toHaveLength(3);
    expect(f.tees).toHaveLength(2);
    expect(f.fairways).toHaveLength(2);
    expect(f.bunkers).toHaveLength(3);
    expect(f.water).toHaveLength(1); // multipolygon outer only, island skipped
    expect(f.woods).toHaveLength(1);
    expect(f.trees).toHaveLength(2);
  });

  it('rejects a response that is not Overpass JSON', () => {
    expect(() => parseOverpass({ hello: 'world' })).toThrow(/unexpected response/);
  });
});

describe('building a preview', () => {
  it('produces contract-valid holes in each hole’s own frame', () => {
    const p = preview();
    expect(() => CoursePreview.parse(p)).not.toThrow();
    expect(p.holes).toHaveLength(3);
    const [h1] = p.holes;
    expect(h1!.geometry.source).toBe('map');
    expect(h1!.geometry.centerline[0]).toEqual([0, 0]);
    expect(h1!.lengthM).toBeCloseTo(340, -1);
    expect(h1!.geometry.green.center[1]).toBeCloseTo(342, -1); // straight ahead
    expect(Math.abs(h1!.geometry.green.center[0])).toBeLessThan(2);
    expect(h1!.geometry.green.radiusM).toBeCloseTo(14, 0);
  });

  it('turns a hole that was drawn backwards around', () => {
    const h2 = preview().holes[1]!;
    expect(h2.par).toBe(3);
    expect(h2.lengthM).toBeCloseTo(150, -1);
    expect(h2.geometry.green.center[1]).toBeGreaterThan(140); // green ahead of the tee, not behind
    expect(h2.has.tee).toBe(true);
  });

  it('assigns each bunker and fairway to the right hole', () => {
    const [h1, h2, h3] = preview().holes;
    expect(h1!.has).toMatchObject({ fairway: true, bunkers: 2, tee: true, green: true });
    expect(h2!.has.bunkers).toBe(1);
    expect(h3!.has).toMatchObject({ fairway: true, bunkers: 0, tee: false, water: 1 });
    // Bunker right of hole 1's green ends up on the player's right (+x).
    const right = h1!.geometry.outlines!.bunkers.find((b) => b.every(([x]) => x > 0));
    expect(right).toBeDefined();
  });

  it('places a dogleg-right correctly', () => {
    // The frame points straight from tee to green, so a dogleg right puts the bend on the left of that line.
    const h3 = preview().holes[2]!;
    const bend = h3.geometry.centerline[1]!;
    expect(bend[0]).toBeLessThan(-20);
    expect(Math.abs(h3.geometry.green.center[0])).toBeLessThan(15);
  });

  it('keeps mapped trees and samples woods, but never invents trees', () => {
    const [h1, , h3] = preview().holes;
    expect(h1!.geometry.trees!.length).toBeGreaterThan(5);
    const empty = buildPreview(
      parseOverpass({ elements: osmCourseFixture().elements.filter((e) => !(e.tags && ('natural' in e.tags))) }),
      meta,
    ).preview;
    expect(empty.holes.every((h) => (h.geometry.trees ?? []).length === 0)).toBe(true);
    expect(h3).toBeDefined();
  });

  it('tells the player what is missing', () => {
    const notes = preview().notes.join(' ');
    expect(notes).toMatch(/3 holes are mapped/);
    expect(notes).toMatch(/Par is missing on 1 hole/);
  });

  it('says so plainly when no holes are mapped', () => {
    const p = buildPreview(parseOverpass({ elements: [] }), meta).preview;
    expect(p.holes).toHaveLength(0);
    expect(p.notes[0]).toMatch(/No holes are mapped/);
  });
});

function fakeHttp(responses: { get?: unknown[]; post?: unknown }): Http & { gets: string[] } {
  const gets: string[] = [];
  const queue = [...(responses.get ?? [])];
  return {
    gets,
    getJson: async (url) => {
      gets.push(url);
      return queue.shift() ?? [];
    },
    postForm: async () => responses.post,
    getBuffer: async () => null,
  };
}

describe('search', () => {
  it('keeps golf courses only, formats the place, and flags ones already imported', async () => {
    const db = freshDb();
    const http = fakeHttp({ get: [nominatimFixture] });
    const found = await searchCourses(db, http, 'Test Links');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Test Links', place: 'Seattle, Washington, United States', alreadyImported: false });
    expect(found[0]!.bbox).toEqual([47.689, -122.301, 47.696, -122.294]);
    expect(http.gets[0]).toMatch(/format=jsonv2/);
  });

  it('retries with "golf" added when the first search finds no courses', async () => {
    const db = freshDb();
    const http = fakeHttp({ get: [[], nominatimFixture] });
    const found = await searchCourses(db, http, 'Test Links');
    expect(found).toHaveLength(1);
    expect(new URL(http.gets[1]!).searchParams.get('q')).toBe('Test Links golf');
  });

  it('refuses an area far too large to be a course', async () => {
    await expect(previewCourse(fakeHttp({}), { ...meta, bbox: [47, -123, 48, -122] })).rejects.toThrow(/too large/);
  });
});

describe('importing', () => {
  const nineHoles = () => {
    const p = preview();
    const holes = Array.from({ length: 9 }, (_, i) => {
      const src = p.holes[i % 3]!;
      return { number: i + 1, par: src.par ?? 4, strokeIndex: i + 1, lengthM: src.lengthM, geometry: src.geometry };
    });
    return CourseImport.parse({ osm: meta.osm, name: 'Test Links', location: 'Seattle', tee: { name: 'Blue', courseRating: 70.1, slopeRating: 125 }, holes });
  };

  it('saves the real layout with attribution, and refuses a second import of the same course', () => {
    const db = freshDb();
    const id = importCourse(db, nineHoles());
    const course = getCourse(db, id);
    expect(course.source).toBe('imported');
    expect(course.attribution).toMatch(/OpenStreetMap/);
    expect(course.holes).toHaveLength(9);
    expect(course.holes[0]!.geometry?.source).toBe('map');
    expect(course.holes[0]!.geometry?.outlines?.greens).toHaveLength(1);
    expect(() => importCourse(db, nineHoles())).toThrow(/already in your courses/);
  });

  it('requires 9 or 18 holes numbered from 1', () => {
    const base = nineHoles();
    expect(CourseImport.safeParse({ ...base, holes: base.holes.slice(0, 5) }).success).toBe(false);
    expect(CourseImport.safeParse({ ...base, holes: base.holes.map((h, i) => ({ ...h, number: i + 10 })) }).success).toBe(false);
  });
});

describe('network errors', () => {
  const fetchReturning = (status: number) => async () => ({ ok: status < 400, status, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });

  it('explains a busy service and an unreachable one in plain words', async () => {
    await expect(createHttp(fetchReturning(429)).getJson('https://x.test', 1000)).rejects.toThrow(/busy/);
    const offline = createHttp(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline.getJson('https://x.test', 1000)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(offline.getJson('https://x.test', 1000)).rejects.toBeInstanceOf(DomainError);
  });

  it('times out instead of hanging', async () => {
    const slow = createHttp(
      (_url, init) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    );
    await expect(slow.getJson('https://x.test', 50)).rejects.toThrow(/too long/);
  });
});
