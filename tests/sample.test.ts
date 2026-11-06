import { describe, expect, it } from 'vitest';
import { HoleGeometry, SHOT_METRIC_LIMITS, ShotMetrics } from '@shared/schemas';
import { ensureBuiltinDrills } from '../src/main/db/seed/drills';
import { clearSampleData, countBySource, loadSampleData } from '../src/main/db/seed/sample';
import { freshDb } from './helpers';

const NOW = new Date('2026-11-05T12:00:00Z');

function seeded() {
  const db = freshDb();
  ensureBuiltinDrills(db);
  loadSampleData(db, NOW);
  return db;
}

const COLS: Record<keyof typeof SHOT_METRIC_LIMITS, string> = {
  carryM: 'carry_m', totalM: 'total_m', offlineM: 'offline_m', ballSpeedMps: 'ball_speed_mps',
  clubSpeedMps: 'club_speed_mps', launchDeg: 'launch_deg', launchDirDeg: 'launch_dir_deg', spinRpm: 'spin_rpm',
  spinAxisDeg: 'spin_axis_deg', apexM: 'apex_m', descentDeg: 'descent_deg', attackDeg: 'attack_deg',
  clubPathDeg: 'club_path_deg', faceAngleDeg: 'face_angle_deg',
};

describe('sample data', () => {
  it('loads a complete, fully tagged dataset', () => {
    const db = seeded();
    const sample = countBySource(db, 'sample');
    expect(sample).toMatchObject({ clubs: 15, bags: 1, courses: 1, rounds: 14, practicePlans: 2, practiceLogs: 16 });
    expect(sample.sessions).toBe(16); // 12 range/sim + 4 tracked rounds
    expect(sample.shots).toBeGreaterThan(400);
    expect(Object.values(countBySource(db, 'own')).every((n) => n === 0)).toBe(true);
  });

  it('is deterministic for a given date', () => {
    const sig = () =>
      seeded().prepare('SELECT count(*) AS n, round(sum(coalesce(carry_m,0) + coalesce(total_m,0)), 1) AS s FROM shot').get();
    expect(sig()).toEqual(sig());
  });

  it('dates everything in the past except the upcoming practice plan', () => {
    const db = seeded();
    const latest = db.prepare<[], { d: string }>('SELECT max(played_on) AS d FROM round').get()?.d ?? '';
    expect(latest <= '2026-11-05').toBe(true);
    expect(db.prepare("SELECT count(*) AS n FROM practice_plan WHERE scheduled_for > '2026-11-05'").get()).toEqual({ n: 1 });
  });

  it('only uses generic clubs and a course labelled fictional', () => {
    const db = seeded();
    expect(db.prepare('SELECT count(*) AS n FROM club WHERE make IS NOT NULL OR model IS NOT NULL').get()).toEqual({ n: 0 });
    expect(db.prepare<[], { location: string }>('SELECT location FROM course').get()?.location).toMatch(/fictional/i);
  });

  it('stores valid 3D layouts for every hole', () => {
    const db = seeded();
    const rows = db.prepare<[], { geometry: string }>('SELECT geometry FROM hole').all();
    expect(rows).toHaveLength(18);
    for (const r of rows) expect(() => HoleGeometry.parse(JSON.parse(r.geometry))).not.toThrow();
  });

  it('produces launch data that passes validation and orders sensibly by club', () => {
    const db = seeded();
    const rows = db.prepare<[], Record<string, number | null>>("SELECT * FROM shot WHERE lie = 'mat'").all();
    for (const row of rows) {
      const metrics = Object.fromEntries(Object.entries(COLS).map(([k, col]) => [k, row[col] ?? null]));
      expect(() => ShotMetrics.parse(metrics)).not.toThrow();
    }
    const means = db
      .prepare<[], { label: string; carry: number }>(
        `SELECT c.label, avg(s.carry_m) AS carry FROM shot s JOIN club c ON c.id = s.club_id
         WHERE s.lie = 'mat' AND s.excluded = 0 GROUP BY c.id ORDER BY c.loft_deg`,
      )
      .all();
    expect(means.length).toBeGreaterThan(6);
    for (let i = 1; i < means.length; i++) expect(means[i]!.carry).toBeLessThan(means[i - 1]!.carry);
  });

  it('leaves fields NULL when the sample device could not measure them', () => {
    const db = seeded();
    const basic = db.prepare(
      "SELECT count(*) AS n FROM shot s JOIN session x ON x.id = s.session_id WHERE x.kind = 'range' AND s.club_path_deg IS NOT NULL",
    ).get();
    expect(basic).toEqual({ n: 0 });
  });

  it('keeps on-course shot tracks consistent with the scorecard', () => {
    const db = seeded();
    const holes = db
      .prepare<[], { strokes: number; penalties: number; putts: number; first_putt_m: number | null; tracked: number; putts_tracked: number }>(
        `SELECT hs.strokes, hs.penalties, hs.putts, hs.first_putt_m,
                count(s.id) AS tracked, sum(s.lie = 'green') AS putts_tracked
         FROM hole_score hs JOIN shot s ON s.hole_score_id = hs.id GROUP BY hs.id`,
      )
      .all();
    expect(holes.length).toBe(18 * 4);
    for (const h of holes) {
      expect(h.tracked).toBe(h.strokes - h.penalties);
      expect(h.putts_tracked).toBe(h.putts);
    }
  });

  it('starts each first putt at the recorded first-putt distance', () => {
    const db = seeded();
    const rows = db
      .prepare<[], { first_putt_m: number; sx: number; sy: number; px: number; py: number }>(
        `SELECT hs.first_putt_m, f.start_x_m AS sx, f.start_y_m AS sy, l.end_x_m AS px, l.end_y_m AS py
         FROM hole_score hs
         JOIN shot f ON f.id = (SELECT id FROM shot WHERE hole_score_id = hs.id AND lie = 'green' ORDER BY seq LIMIT 1)
         JOIN shot l ON l.id = (SELECT id FROM shot WHERE hole_score_id = hs.id ORDER BY seq DESC LIMIT 1)
         WHERE hs.putts > 0`,
      )
      .all();
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows) expect(Math.hypot(r.sx - r.px, r.sy - r.py)).toBeCloseTo(r.first_putt_m, 0);
  });

  it('refuses to load twice', () => {
    const db = seeded();
    expect(() => loadSampleData(db, NOW)).toThrow(/already loaded/);
  });

  it('clears all sample rows but never your own data or the drill library', () => {
    const db = seeded();
    const drills = db.prepare('SELECT count(*) AS n FROM drill').get();
    const ownClub = db.prepare("INSERT INTO club (kind, label) VALUES ('wedge', 'My 60')").run().lastInsertRowid;
    const ownSession = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
    db.prepare('INSERT INTO shot (session_id, club_id, seq, carry_m) VALUES (?, ?, 1, 55)').run(ownSession, ownClub);

    const result = clearSampleData(db);
    expect(Object.values(countBySource(db, 'sample')).every((n) => n === 0)).toBe(true);
    expect(result.removed.shots).toBeGreaterThan(400);
    expect(countBySource(db, 'own')).toMatchObject({ clubs: 1, sessions: 1, shots: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM drill').get()).toEqual(drills);
  });

  it('keeps a sample club you have started using, and says so', () => {
    const db = seeded();
    const sevenIron = db.prepare<[], { id: number }>("SELECT id FROM club WHERE label = '7 Iron'").get()!.id;
    const own = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
    db.prepare('INSERT INTO shot (session_id, club_id, seq, carry_m) VALUES (?, ?, 1, 131)').run(own, sevenIron);

    const result = clearSampleData(db);
    expect(result.kept.clubs).toBe(1);
    expect(db.prepare('SELECT label FROM club WHERE id = ?').get(sevenIron)).toEqual({ label: '7 Iron' });
  });

  it('can be loaded again after clearing', () => {
    const db = seeded();
    clearSampleData(db);
    expect(() => loadSampleData(db, NOW)).not.toThrow();
  });
});

describe('shot limits agree between database and validation', () => {
  const db = freshDb();
  const club = db.prepare("INSERT INTO club (kind, label) VALUES ('iron', '7 Iron')").run().lastInsertRowid;
  const session = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
  let seq = 1;

  for (const [key, [min, max]] of Object.entries(SHOT_METRIC_LIMITS)) {
    const col = COLS[key as keyof typeof COLS];
    it(`${key}: [${min}, ${max}]`, () => {
      const insert = (v: number) =>
        db.prepare(`INSERT INTO shot (session_id, club_id, seq, ${col}) VALUES (?, ?, ?, ?)`).run(session, club, seq++, v);
      const zodAccepts = (v: number) => ShotMetrics.shape[key as keyof typeof ShotMetrics.shape].safeParse(v).success;
      for (const v of [min, max]) {
        expect(() => insert(v)).not.toThrow();
        expect(zodAccepts(v)).toBe(true);
      }
      for (const v of [min - 0.1, max + 0.1]) {
        expect(() => insert(v)).toThrow(/CHECK/);
        expect(zodAccepts(v)).toBe(false);
      }
    });
  }
});
