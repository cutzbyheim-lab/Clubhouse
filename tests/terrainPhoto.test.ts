import { describe, expect, it } from 'vitest';
import { CourseImport, CoursePreview } from '@shared/dto';
import { getCourse } from '../src/main/db/repositories/courses';
import { detectCourseTrees, holeImagery, importCourse, previewCourse } from '../src/main/services/courseImport';
import { buildPreview } from '../src/main/services/osm/build';
import { parseOverpass } from '../src/main/services/osm/parse';
import { ELEVATION, IMAGERY, decodeImage, fetchRaster, lonLatToPixel, pixelToLonLat, terrariumHeight } from '../src/main/services/osm/tiles';
import { classify } from '../src/main/services/osm/photoCheck';
import { osmCourseFixture } from './fixtures/osmCourse';
import { groundHeight, tileServer } from './fixtures/tiles';
import { freshDb } from './helpers';

const meta = { osm: { type: 'way' as const, id: 4242 }, name: 'Test Links', place: 'Seattle' };
const features = () => parseOverpass(osmCourseFixture());
const bbox = { south: 47.6895, north: 47.6955, west: -122.3015, east: -122.2935 };

async function rasters(photo: Parameters<typeof tileServer>[1]) {
  const http = tileServer(features(), photo);
  const [elevation, img] = await Promise.all([
    fetchRaster(http, bbox, ELEVATION, { skipBlank: false }),
    fetchRaster(http, bbox, IMAGERY, { skipBlank: true }),
  ]);
  return { elevation, photo: img };
}

describe('tile maths and decoding', () => {
  it('round-trips lat/lon through Web Mercator pixels', () => {
    const [px, py] = lonLatToPixel(47.69, -122.3, 17);
    const back = pixelToLonLat(px, py, 17);
    expect(back.lat).toBeCloseTo(47.69, 6);
    expect(back.lon).toBeCloseTo(-122.3, 6);
  });

  it('decodes Terrarium heights, interpolating decoded values', async () => {
    const http = tileServer(features(), null);
    const r = await fetchRaster(http, bbox, ELEVATION, { skipBlank: false });
    expect(r).not.toBeNull();
    const h = r!.scalar(47.692, -122.298, terrariumHeight)!;
    expect(h).toBeCloseTo(groundHeight(47.692, -122.298), 0);
  });

  it('classifies photo colours', () => {
    expect(classify([222, 206, 160])).toBe('sand');
    expect(classify([38, 66, 92])).toBe('water');
    expect(classify([96, 152, 78])).toBe('turf');
    expect(classify([62, 98, 58])).toBe('turf');
    expect(classify([228, 226, 220])).toBe('sand'); // white sand
    expect(classify([120, 124, 118])).toBe('other'); // grey cart path, too dark for sand
  });
});

describe('measured terrain', () => {
  it('gives every hole a height grid relative to its tee that follows the real ground', async () => {
    const { elevation } = await rasters(null);
    const { preview } = buildPreview(features(), meta, { photo: null, elevation });
    expect(() => CoursePreview.parse(preview)).not.toThrow();
    const h1 = preview.holes[0]!.geometry;
    expect(h1.elevation).toBeDefined();
    // Hole 1 runs 342 m north on ground rising 5 m per 100 m: green ~17 m above the tee.
    expect(h1.greenElevationM).toBeGreaterThan(15.5);
    expect(h1.greenElevationM).toBeLessThan(18.5);
    // The tee itself is at 0 in the grid.
    const e = h1.elevation!;
    const col = Math.round((0 - e.x0) / e.stepM);
    const row = Math.round((0 - e.y0) / e.stepM);
    expect(Math.abs(e.heights[row * e.cols + col]!)).toBeLessThan(0.6);
    expect(preview.terrain.available).toBe(true);
    expect(preview.terrain.reliefM).toBeGreaterThan(15);
    expect(preview.credits.join(' ')).toMatch(/Terrain Tiles/);
  });

  it('stays flat (no invented terrain) when elevation is unavailable', () => {
    const { preview } = buildPreview(features(), meta, { photo: null, elevation: null });
    expect(preview.holes.every((h) => h.geometry.elevation === undefined && h.geometry.greenElevationM === 0)).toBe(true);
    expect(preview.terrain.available).toBe(false);
  });
});

describe('checking the map against an aerial photo', () => {
  it('detects that the map is off the photo, measures the shift, and lines it up', async () => {
    const { elevation, photo } = await rasters({ truthShift: [6, -4], hazards: true });
    expect(photo).not.toBeNull();
    const { preview, images } = buildPreview(features(), meta, { photo, elevation });
    expect(preview.photoCheck.available).toBe(true);
    const [sx, sy] = preview.photoCheck.shiftM!;
    expect(Math.abs(sx - 6)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(sy + 4)).toBeLessThanOrEqual(1.5);
    expect(preview.photoCheck.summary).toMatch(/moved to line up/);
    // After alignment, holes with bunkers or water verify against the photo.
    const verdicts = preview.holes.map((h) => h.geometry.check?.verdict);
    expect(verdicts[0]).toBe('match'); // two bunkers
    expect(verdicts[2]).toBe('match'); // lake
    expect(preview.photo?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(images.size).toBe(3);
    const first = images.get(preview.holes[0]!.key)!;
    expect(decodeImage(first.jpeg).width).toBe(first.width);
  });

  it('needs no shift when the map is already right', async () => {
    const { photo } = await rasters({ truthShift: [0, 0], hazards: true });
    const { preview } = buildPreview(features(), meta, { photo, elevation: null });
    expect(preview.photoCheck.shiftM).toBeNull();
    expect(preview.holes[0]!.geometry.check?.verdict).toBe('match');
  });

  it('flags holes whose mapped bunkers and water are not in the photo', async () => {
    const { photo } = await rasters({ truthShift: [0, 0], hazards: false });
    const { preview } = buildPreview(features(), meta, { photo, elevation: null });
    expect(preview.photoCheck.shiftM).toBeNull();
    expect(preview.holes[0]!.geometry.check?.verdict).toBe('mismatch');
    expect(preview.holes[2]!.geometry.check?.verdict).toBe('mismatch');
    expect(preview.photoCheck.summary).toMatch(/don't match/);
  });

  it('says plainly when there is no photo for the area', () => {
    const { preview } = buildPreview(features(), meta, { photo: null, elevation: null });
    expect(preview.photoCheck.available).toBe(false);
    expect(preview.photoCheck.summary).toMatch(/No aerial photo/);
    expect(preview.holes.every((h) => h.geometry.check?.verdict === 'unchecked')).toBe(true);
  });
});

describe('end to end: preview, import, read the photo back', () => {
  it('stores each hole’s photo with the course and serves it to the 3D view', async () => {
    const http = tileServer(features(), { truthShift: [6, -4], hazards: true }, osmCourseFixture());
    const preview = await previewCourse(http, { ...meta, bbox: [47.6895, -122.3015, 47.6955, -122.2935] });
    expect(http.requests.some((u) => u.includes('terrarium'))).toBe(true);
    expect(http.requests.some((u) => u.includes('USGSImageryOnly'))).toBe(true);

    const holes = Array.from({ length: 9 }, (_, i) => {
      const src = preview.holes[i % 3]!;
      return { key: i < 3 ? src.key : undefined, number: i + 1, par: src.par ?? 4, strokeIndex: null, lengthM: src.lengthM, geometry: src.geometry };
    });
    const input = CourseImport.parse({ osm: meta.osm, name: 'Test Links', location: null, tee: { name: 'White', courseRating: null, slopeRating: null }, holes });
    const db = freshDb();
    const id = importCourse(db, input);
    const course = getCourse(db, id);
    const withPhoto = course.holes.filter((h) => h.geometry?.imageryBounds);
    expect(withPhoto).toHaveLength(3); // holes 4–9 reused geometry without a key: no photo claimed
    const img = holeImagery(db, withPhoto[0]!.id);
    expect(img?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(img?.attribution).toMatch(/USGS/);
    expect(course.holes[0]!.geometry?.elevation).toBeDefined();
    expect(holeImagery(db, course.holes[5]!.id)).toBeNull();
  });
});

describe('trees from the aerial photo', () => {
  const pip = (x: number, y: number, poly: readonly (readonly [number, number])[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };

  function plant() {
    // Plant crowns 35–60 m either side of each fairway's middle.
    const f = features();
    const O = { lat: 47.6925, lon: -122.2975 };
    const kx = 111320 * Math.cos((O.lat * Math.PI) / 180);
    return f.fairways.flatMap((poly, i) => {
      const c = poly.reduce((a, p) => ({ lat: a.lat + p.lat / poly.length, lon: a.lon + p.lon / poly.length }), { lat: 0, lon: 0 });
      const m: [number, number] = [(c.lon - O.lon) * kx, (c.lat - O.lat) * 110540];
      return [-1, 1].map((side) => ({ at: [m[0] + side * (40 + (i % 3) * 8), m[1] + side * 6] as [number, number], r: 3.5 + (i % 4) * 0.6 }));
    });
  }
  const withTrees = async () => rasters({ truthShift: [0, 0], hazards: true, trees: plant() });

  it('finds trees around the holes and never on mapped turf, sand or water', { timeout: 30_000 }, async () => {
    const { elevation, photo } = await withTrees();
    const { preview } = buildPreview(features(), meta, { photo, elevation });
    const withPhoto = preview.holes.filter((h) => h.geometry.imageryBounds);
    expect(withPhoto.length).toBeGreaterThan(0);
    const total = withPhoto.reduce((s, h) => s + (h.geometry.photoTrees?.length ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(preview.photoCheck.summary).toMatch(/Found about [\d,]+ trees in the photo/);
    for (const h of withPhoto) {
      const o = h.geometry.outlines!;
      for (const t of h.geometry.photoTrees ?? []) for (const poly of [...o.greens, ...o.fairways, ...o.bunkers, ...o.water]) expect(pip(t[0], t[1], poly)).toBe(false);
    }
  });

  it('doesn’t invent trees in plain rough', { timeout: 30_000 }, async () => {
    const { elevation, photo } = await rasters({ truthShift: [0, 0], hazards: true });
    const { preview } = buildPreview(features(), meta, { photo, elevation });
    for (const h of preview.holes) expect(h.geometry.photoTrees?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it('finds trees for a course imported before tree detection, from its stored photos', async () => {
    const db = freshDb();
    const http = tileServer(features(), { truthShift: [0, 0], hazards: true, trees: plant() }, osmCourseFixture());
    const preview = await previewCourse(http, { ...meta, bbox: [47.6895, -122.3015, 47.6955, -122.2935] });
    const holes = Array.from({ length: 9 }, (_, i) => {
      const src = preview.holes[i % preview.holes.length]!;
      return { key: i < preview.holes.length ? src.key : undefined, number: i + 1, par: src.par ?? 4, strokeIndex: null, lengthM: src.lengthM, geometry: src.geometry };
    });
    const input = CourseImport.parse({ osm: meta.osm, name: 'Test Links', location: null, tee: { name: 'White', courseRating: null, slopeRating: null }, holes });
    const id = importCourse(db, input);
    const course = { id };
    // Make it look like an older import: no photo trees stored.
    for (const h of getCourse(db, course.id).holes) {
      const { photoTrees: _drop, ...rest } = h.geometry!;
      db.prepare('UPDATE hole SET geometry = ? WHERE id = ?').run(JSON.stringify(rest), h.id);
    }
    const res = await detectCourseTrees(db, course.id);
    expect(res.holes).toBe(3); // only holes with a stored photo can be searched
    const after = getCourse(db, course.id).holes.map((h) => h.geometry?.photoTrees);
    expect(after.map((t) => t?.length ?? 0).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    // Running again finds nothing left to do.
    expect((await detectCourseTrees(db, course.id)).holes).toBe(0);
  }, 30_000);
});
