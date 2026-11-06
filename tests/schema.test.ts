import { describe, expect, it } from 'vitest';
import { freshDb, insertClub, insertCourse } from './helpers';

describe('schema 0001', () => {
  it('creates every domain table (through the latest migration)', () => {
    const db = freshDb();
    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((t) => t.name);
    expect(tables).toEqual(
      [
        'app_setting',
        'bag',
        'bag_club',
        'club',
        'course',
        'course_tee',
        'drill',
        'hole',
        'hole_length',
        'hole_imagery',
        'hole_score',
        'insight_dismissal',
        'player_analysis',
        'player_profile',
        'practice_log',
        'practice_plan',
        'practice_plan_item',
        'round',
        'schema_migrations',
        'session',
        'shot',
      ].sort(),
    );
  });

  it('only accepts valid JSON for a club’s model info', () => {
    const db = freshDb();
    expect(() => db.prepare("INSERT INTO club (kind, label, model_info) VALUES ('iron', '7 Iron', 'not json')").run()).toThrow(/CHECK/);
  });

  it('keeps exactly one player profile row', () => {
    const db = freshDb();
    expect(() => db.prepare('INSERT INTO player_profile (id) VALUES (2)').run()).toThrow(/CHECK/);
  });

  it('enforces STRICT column types', () => {
    const db = freshDb();
    const sid = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
    const cid = insertClub(db);
    expect(() =>
      db.prepare("INSERT INTO shot (session_id, club_id, seq, carry_m) VALUES (?, ?, 1, 'far')").run(sid, cid),
    ).toThrow(/cannot store TEXT/);
  });

  it('rejects implausible measurements but accepts NULL for uncaptured ones', () => {
    const db = freshDb();
    const sid = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
    const cid = insertClub(db);
    const ins = db.prepare('INSERT INTO shot (session_id, club_id, seq, carry_m, ball_speed_mps) VALUES (?, ?, ?, ?, ?)');
    expect(() => ins.run(sid, cid, 1, 900, null)).toThrow(/CHECK/);
    expect(() => ins.run(sid, cid, 2, 140, 200)).toThrow(/CHECK/);
    expect(() => ins.run(sid, cid, 3, null, null)).not.toThrow();
  });

  it('requires total distance to be at least carry', () => {
    const db = freshDb();
    const sid = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
    const cid = insertClub(db);
    expect(() =>
      db
        .prepare('INSERT INTO shot (session_id, club_id, seq, carry_m, total_m) VALUES (?, ?, 1, 150, 140)')
        .run(sid, cid),
    ).toThrow(/CHECK/);
  });

  it('validates calendar dates and ISO timestamps', () => {
    const db = freshDb();
    const { courseId } = insertCourse(db);
    const ins = db.prepare('INSERT INTO round (course_id, played_on) VALUES (?, ?)');
    expect(() => ins.run(courseId, '2026-02-30')).toThrow(/CHECK/);
    expect(() => ins.run(courseId, '11/05/2026')).toThrow(/CHECK/);
    expect(() => ins.run(courseId, '2026-11-05')).not.toThrow();
    expect(() => db.prepare("INSERT INTO session (kind, started_at) VALUES ('range', 'yesterday')").run()).toThrow(
      /CHECK/,
    );
  });

  it('limits a bag to 14 clubs and one club per slot', () => {
    const db = freshDb();
    const bagId = db.prepare("INSERT INTO bag (name) VALUES ('Main')").run().lastInsertRowid;
    const add = db.prepare('INSERT INTO bag_club (bag_id, club_id, slot) VALUES (?, ?, ?)');
    for (let i = 1; i <= 14; i++) add.run(bagId, insertClub(db, `Club ${i}`), i);
    const extra = insertClub(db, 'Club 15');
    expect(() => add.run(bagId, extra, 14)).toThrow(/at most 14 clubs/);

    const bag2 = db.prepare("INSERT INTO bag (name) VALUES ('Travel')").run().lastInsertRowid;
    add.run(bag2, extra, 1);
    expect(() => add.run(bag2, insertClub(db, 'Club 16'), 1)).toThrow(/UNIQUE/);
  });

  it('allows only one active bag', () => {
    const db = freshDb();
    db.prepare("INSERT INTO bag (name, is_active) VALUES ('A', 1)").run();
    db.prepare("INSERT INTO bag (name, is_active) VALUES ('B', 0)").run();
    expect(() => db.prepare("INSERT INTO bag (name, is_active) VALUES ('C', 1)").run()).toThrow(/UNIQUE/);
  });

  it('keeps hole scores consistent', () => {
    const db = freshDb();
    const { courseId, holeIds } = insertCourse(db);
    const roundId = db.prepare("INSERT INTO round (course_id, played_on) VALUES (?, '2026-10-01')").run(courseId)
      .lastInsertRowid;
    const ins = db.prepare('INSERT INTO hole_score (round_id, hole_id, strokes, putts, penalties) VALUES (?, ?, ?, ?, ?)');
    expect(() => ins.run(roundId, holeIds[0], 3, 4, 0)).toThrow(/CHECK/); // more putts than strokes
    expect(() => ins.run(roundId, holeIds[0], 4, 2, 3)).toThrow(/CHECK/); // putts + penalties > strokes
    ins.run(roundId, holeIds[0], 5, 2, 1);
    expect(() => ins.run(roundId, holeIds[0], 4, 2, 0)).toThrow(/UNIQUE/); // same hole twice
  });

  it('cascades round deletion to its scores and course sessions, but protects courses in use', () => {
    const db = freshDb();
    const { courseId, holeIds } = insertCourse(db);
    const roundId = db.prepare("INSERT INTO round (course_id, played_on) VALUES (?, '2026-10-01')").run(courseId)
      .lastInsertRowid;
    db.prepare('INSERT INTO hole_score (round_id, hole_id, strokes) VALUES (?, ?, 4)').run(roundId, holeIds[0]);
    db.prepare("INSERT INTO session (kind, round_id) VALUES ('course', ?)").run(roundId);

    expect(() => db.prepare('DELETE FROM course WHERE id = ?').run(courseId)).toThrow(/FOREIGN KEY/);
    db.prepare('DELETE FROM round WHERE id = ?').run(roundId);
    expect(db.prepare('SELECT count(*) AS n FROM hole_score').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM session').get()).toEqual({ n: 0 });
  });

  it('protects clubs that have recorded shots', () => {
    const db = freshDb();
    const cid = insertClub(db);
    const sid = db.prepare("INSERT INTO session (kind) VALUES ('range')").run().lastInsertRowid;
    db.prepare('INSERT INTO shot (session_id, club_id, seq, carry_m) VALUES (?, ?, 1, 140)').run(sid, cid);
    expect(() => db.prepare('DELETE FROM club WHERE id = ?').run(cid)).toThrow(/FOREIGN KEY/);
  });

  it('only links range sessions to rounds when they are course sessions', () => {
    const db = freshDb();
    const { courseId } = insertCourse(db);
    const roundId = db.prepare("INSERT INTO round (course_id, played_on) VALUES (?, '2026-10-01')").run(courseId)
      .lastInsertRowid;
    expect(() => db.prepare("INSERT INTO session (kind, round_id) VALUES ('range', ?)").run(roundId)).toThrow(
      /CHECK/,
    );
  });

  it('restricts provenance to known sources', () => {
    const db = freshDb();
    expect(() => db.prepare("INSERT INTO club (kind, label, source) VALUES ('iron','7 Iron','guessed')").run()).toThrow(
      /CHECK/,
    );
  });
});
