import type { CourseCreate, CourseSummary, HoleRecord, HoleTrack } from '@shared/dto';
import { HoleGeometry, type CourseDetail } from '@shared/schemas';
import type { DB } from '../connection';
import { DomainError } from '../../errors';

export function listCourses(db: DB): CourseSummary[] {
  const courses = db
    .prepare<
      [],
      { id: number; name: string; location: string | null; source: CourseSummary['source']; attribution: string | null; holes: number; par: number; rounds: number }
    >(
      `SELECT c.id, c.name, c.location, c.source, c.attribution,
              (SELECT count(*) FROM hole h WHERE h.course_id = c.id) AS holes,
              (SELECT coalesce(sum(par), 0) FROM hole h WHERE h.course_id = c.id) AS par,
              (SELECT count(*) FROM round r WHERE r.course_id = c.id) AS rounds
       FROM course c ORDER BY rounds DESC, c.name`,
    )
    .all();
  const tees = db.prepare<
    [number],
    { id: number; name: string; course_rating: number | null; slope_rating: number | null; length_m: number | null }
  >(
    `SELECT t.id, t.name, t.course_rating, t.slope_rating, sum(hl.length_m) AS length_m
     FROM course_tee t LEFT JOIN hole_length hl ON hl.tee_id = t.id
     WHERE t.course_id = ? GROUP BY t.id ORDER BY length_m DESC`,
  );
  return courses.map((c) => ({
    ...c,
    tees: tees.all(c.id).map((t) => ({
      id: t.id,
      name: t.name,
      courseRating: t.course_rating,
      slopeRating: t.slope_rating,
      lengthM: t.length_m,
    })),
  }));
}

export function getCourse(db: DB, id: number): CourseDetail {
  const c = db
    .prepare<[number], { id: number; name: string; location: string | null; notes: string | null; source: CourseDetail['source']; attribution: string | null; created_at: string }>(
      'SELECT id, name, location, notes, source, attribution, created_at FROM course WHERE id = ?',
    )
    .get(id);
  if (!c) throw new DomainError('NOT_FOUND', 'That course no longer exists');
  const tees = db
    .prepare<[number], { id: number; name: string; course_rating: number | null; slope_rating: number | null }>(
      'SELECT id, name, course_rating, slope_rating FROM course_tee WHERE course_id = ? ORDER BY id',
    )
    .all(id);
  const holes = db
    .prepare<[number], { id: number; number: number; par: number; stroke_index: number | null; geometry: string | null }>(
      'SELECT id, number, par, stroke_index, geometry FROM hole WHERE course_id = ? ORDER BY number',
    )
    .all(id);
  const lengths = db
    .prepare<[number], { hole_id: number; tee_id: number; length_m: number }>(
      'SELECT hl.hole_id, hl.tee_id, hl.length_m FROM hole_length hl JOIN hole h ON h.id = hl.hole_id WHERE h.course_id = ?',
    )
    .all(id);
  return {
    id: c.id,
    name: c.name,
    location: c.location,
    notes: c.notes,
    source: c.source,
    attribution: c.attribution,
    createdAt: c.created_at,
    tees: tees.map((t) => ({ id: t.id, name: t.name, courseRating: t.course_rating, slopeRating: t.slope_rating })),
    holes: holes.map((h) => {
      const parsed = h.geometry ? HoleGeometry.safeParse(JSON.parse(h.geometry)) : null;
      return {
        id: h.id,
        number: h.number,
        par: h.par,
        strokeIndex: h.stroke_index,
        geometry: parsed?.success ? parsed.data : null,
        lengthsM: Object.fromEntries(lengths.filter((l) => l.hole_id === h.id).map((l) => [String(l.tee_id), l.length_m])),
      };
    }),
  };
}

/** Creates a course with one set of tees. No 3D layout: that's only ever drawn from real geometry. */
export function createCourse(db: DB, input: CourseCreate): number {
  return db.transaction(() => {
    const courseId = Number(db.prepare('INSERT INTO course (name, location) VALUES (?, ?)').run(input.name, input.location).lastInsertRowid);
    const teeId = Number(
      db
        .prepare('INSERT INTO course_tee (course_id, name, course_rating, slope_rating) VALUES (?, ?, ?, ?)')
        .run(courseId, input.tee.name, input.tee.courseRating, input.tee.slopeRating).lastInsertRowid,
    );
    const insHole = db.prepare('INSERT INTO hole (course_id, number, par, stroke_index) VALUES (?, ?, ?, ?)');
    const insLen = db.prepare('INSERT INTO hole_length (tee_id, hole_id, length_m) VALUES (?, ?, ?)');
    for (const h of input.holes) {
      const holeId = Number(insHole.run(courseId, h.number, h.par, h.strokeIndex).lastInsertRowid);
      if (h.lengthM !== null) insLen.run(teeId, holeId, h.lengthM);
    }
    return courseId;
  })();
}

export function holeRecord(db: DB, holeId: number): HoleRecord {
  const agg = db
    .prepare<[number], { played: number; avg: number | null; best: number | null }>(
      'SELECT count(*) AS played, avg(strokes) AS avg, min(strokes) AS best FROM hole_score WHERE hole_id = ?',
    )
    .get(holeId) ?? { played: 0, avg: null, best: null };
  const rows = db
    .prepare<
      [number],
      {
        round_id: number;
        played_on: string;
        strokes: number;
        par: number;
        seq: number;
        club: string;
        lie: HoleTrack['shots'][number]['lie'];
        sx: number;
        sy: number;
        ex: number | null;
        ey: number | null;
      }
    >(
      `SELECT r.id AS round_id, r.played_on, hs.strokes, h.par, s.seq, c.label AS club, s.lie,
              s.start_x_m AS sx, s.start_y_m AS sy, s.end_x_m AS ex, s.end_y_m AS ey
       FROM hole_score hs
       JOIN round r ON r.id = hs.round_id
       JOIN hole h ON h.id = hs.hole_id
       JOIN shot s ON s.hole_score_id = hs.id
       JOIN club c ON c.id = s.club_id
       WHERE hs.hole_id = ? AND s.start_x_m IS NOT NULL
       ORDER BY r.played_on DESC, s.seq`,
    )
    .all(holeId);
  const tracks = new Map<number, HoleTrack>();
  for (const r of rows) {
    if (r.ex === null || r.ey === null) continue;
    let t = tracks.get(r.round_id);
    if (!t) {
      t = { roundId: r.round_id, playedOn: r.played_on, strokes: r.strokes, par: r.par, shots: [] };
      tracks.set(r.round_id, t);
    }
    t.shots.push({
      seq: r.seq,
      club: r.club,
      lie: r.lie,
      start: [r.sx, r.sy],
      end: [r.ex, r.ey],
      distanceM: Math.hypot(r.ex - r.sx, r.ey - r.sy),
    });
  }
  return { holeId, played: agg.played, avgStrokes: agg.avg, bestStrokes: agg.best, tracks: [...tracks.values()] };
}
