import type { RoundCreate, RoundDetail, RoundSummary } from '@shared/dto';
import type { FairwayResult } from '@shared/schemas';
import type { DB } from '../connection';
import { DomainError } from '../../errors';

interface SummaryRow {
  id: number;
  played_on: string;
  course_id: number;
  course_name: string;
  tee_name: string | null;
  holes_planned: number;
  source: RoundSummary['source'];
  holes_played: number;
  strokes: number;
  par: number;
  putts: number | null;
  putts_holes: number;
  gir: number;
  fairways: number;
  fairway_holes: number;
  penalties: number;
  has_shots: number;
  conditions: string | null;
  notes: string | null;
}

const SUMMARY_SQL = `
  SELECT r.id, r.played_on, r.course_id, c.name AS course_name, t.name AS tee_name, r.holes_planned, r.source,
         r.conditions, r.notes,
         count(hs.id) AS holes_played,
         coalesce(sum(hs.strokes), 0) AS strokes,
         coalesce(sum(h.par), 0) AS par,
         sum(hs.putts) AS putts,
         count(hs.putts) AS putts_holes,
         coalesce(sum(CASE WHEN hs.putts IS NOT NULL AND hs.strokes - hs.putts <= h.par - 2 THEN 1 ELSE 0 END), 0) AS gir,
         coalesce(sum(CASE WHEN hs.fairway = 'hit' THEN 1 ELSE 0 END), 0) AS fairways,
         coalesce(sum(CASE WHEN h.par >= 4 AND hs.fairway IS NOT NULL THEN 1 ELSE 0 END), 0) AS fairway_holes,
         coalesce(sum(hs.penalties), 0) AS penalties,
         EXISTS (SELECT 1 FROM session x WHERE x.round_id = r.id) AS has_shots
  FROM round r
  JOIN course c ON c.id = r.course_id
  LEFT JOIN course_tee t ON t.id = r.tee_id
  LEFT JOIN hole_score hs ON hs.round_id = r.id
  LEFT JOIN hole h ON h.id = hs.hole_id`;

const toSummary = (r: SummaryRow): RoundSummary => ({
  id: r.id,
  playedOn: r.played_on,
  courseId: r.course_id,
  courseName: r.course_name,
  teeName: r.tee_name,
  holesPlanned: r.holes_planned,
  holesPlayed: r.holes_played,
  strokes: r.strokes,
  par: r.par,
  putts: r.putts,
  puttsHoles: r.putts_holes,
  gir: r.gir,
  girHoles: r.putts_holes,
  fairways: r.fairways,
  fairwayHoles: r.fairway_holes,
  penalties: r.penalties,
  hasShots: r.has_shots === 1,
  source: r.source,
});

export const listRounds = (db: DB): RoundSummary[] =>
  db
    .prepare<[], SummaryRow>(`${SUMMARY_SQL} GROUP BY r.id ORDER BY r.played_on DESC, r.id DESC`)
    .all()
    .map(toSummary);

export function getRound(db: DB, id: number): RoundDetail {
  const row = db.prepare<[number], SummaryRow>(`${SUMMARY_SQL} WHERE r.id = ? GROUP BY r.id`).get(id);
  if (!row) throw new DomainError('NOT_FOUND', 'That round no longer exists');
  const holes = db
    .prepare<
      [number, number],
      {
        hole_id: number;
        number: number;
        par: number;
        stroke_index: number | null;
        length_m: number | null;
        strokes: number | null;
        putts: number | null;
        fairway: FairwayResult | null;
        penalties: number | null;
        sand_shots: number | null;
        first_putt_m: number | null;
        scored: number;
      }
    >(
      `SELECT h.id AS hole_id, h.number, h.par, h.stroke_index, hl.length_m,
              hs.strokes, hs.putts, hs.fairway, hs.penalties, hs.sand_shots, hs.first_putt_m, hs.id IS NOT NULL AS scored
       FROM round r
       JOIN hole h ON h.course_id = r.course_id
       LEFT JOIN hole_length hl ON hl.hole_id = h.id AND hl.tee_id = r.tee_id
       LEFT JOIN hole_score hs ON hs.hole_id = h.id AND hs.round_id = r.id
       WHERE r.id = ? AND (h.number <= (SELECT holes_planned FROM round WHERE id = ?) OR hs.id IS NOT NULL)
       ORDER BY h.number`,
    )
    .all(id, id);
  return {
    ...toSummary(row),
    conditions: row.conditions,
    notes: row.notes,
    holes: holes.map((h) => ({
      holeId: h.hole_id,
      number: h.number,
      par: h.par,
      strokeIndex: h.stroke_index,
      lengthM: h.length_m,
      score:
        h.scored === 1 && h.strokes !== null
          ? {
              strokes: h.strokes,
              putts: h.putts,
              fairway: h.fairway,
              penalties: h.penalties ?? 0,
              sandShots: h.sand_shots ?? 0,
              firstPuttM: h.first_putt_m,
            }
          : null,
    })),
  };
}

export function createRound(db: DB, input: RoundCreate): number {
  return db.transaction(() => {
    const course = db.prepare('SELECT 1 FROM course WHERE id = ?').get(input.courseId);
    if (!course) throw new DomainError('NOT_FOUND', 'That course no longer exists');
    if (input.teeId !== null) {
      const tee = db.prepare('SELECT 1 FROM course_tee WHERE id = ? AND course_id = ?').get(input.teeId, input.courseId);
      if (!tee) throw new DomainError('VALIDATION', 'That tee belongs to a different course');
    }
    if (input.scores.length > input.holesPlanned) {
      throw new DomainError('VALIDATION', `A ${input.holesPlanned}-hole round can't have ${input.scores.length} scores`);
    }
    const holes = new Map(
      db
        .prepare<[number], { id: number; par: number }>('SELECT id, par FROM hole WHERE course_id = ?')
        .all(input.courseId)
        .map((h) => [h.id, h.par]),
    );
    const seen = new Set<number>();
    for (const s of input.scores) {
      const par = holes.get(s.holeId);
      if (par === undefined) throw new DomainError('VALIDATION', 'A score refers to a hole on another course');
      if (seen.has(s.holeId)) throw new DomainError('VALIDATION', 'A hole was scored twice');
      seen.add(s.holeId);
      if (par === 3 && s.fairway !== null) throw new DomainError('VALIDATION', 'Fairways are only recorded on par 4s and 5s');
    }
    const complete = input.scores.length === input.holesPlanned;
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO round (course_id, tee_id, played_on, holes_planned, start_hole, conditions, notes, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${complete ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'})`,
        )
        .run(input.courseId, input.teeId, input.playedOn, input.holesPlanned, input.startHole, input.conditions, input.notes)
        .lastInsertRowid,
    );
    const ins = db.prepare(
      `INSERT INTO hole_score (round_id, hole_id, strokes, putts, fairway, penalties, sand_shots, first_putt_m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of input.scores) {
      ins.run(roundId, s.holeId, s.strokes, s.putts, s.fairway, s.penalties, s.sandShots, s.firstPuttM);
    }
    return roundId;
  })();
}

export function deleteRound(db: DB, id: number): void {
  const res = db.prepare('DELETE FROM round WHERE id = ?').run(id);
  if (res.changes === 0) throw new DomainError('NOT_FOUND', 'That round no longer exists');
}

/** Every scored hole joined with its par and round, oldest round first. Input to performance and insights. */
export interface ScoredHole {
  round_id: number;
  played_on: string;
  course_id: number;
  holes_planned: number;
  number: number;
  par: number;
  strokes: number;
  putts: number | null;
  fairway: string | null;
  penalties: number;
  first_putt_m: number | null;
  source: string;
}

export const scoredHoles = (db: DB): ScoredHole[] =>
  db
    .prepare<[], ScoredHole>(
      `SELECT r.id AS round_id, r.played_on, r.course_id, r.holes_planned, h.number, h.par,
              hs.strokes, hs.putts, hs.fairway, hs.penalties, hs.first_putt_m, r.source
       FROM hole_score hs JOIN round r ON r.id = hs.round_id JOIN hole h ON h.id = hs.hole_id
       ORDER BY r.played_on, r.id, h.number`,
    )
    .all();
