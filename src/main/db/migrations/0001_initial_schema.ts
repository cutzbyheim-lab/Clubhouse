import type { Migration } from './types';

/*
 * Initial domain schema. See docs/SCHEMA.md for the entity map.
 *
 * Conventions
 * - STRICT tables: SQLite enforces declared column types.
 * - Canonical units: metres, metres/second, degrees, rpm, grams. Display units
 *   are a renderer concern.
 * - Dates are 'YYYY-MM-DD'; timestamps are ISO-8601 UTC with milliseconds.
 * - Every row holding a *measurement* carries `source` (manual | imported |
 *   sample). Derived values (GIR, smash factor, averages) are never stored.
 * - Measured shot fields are nullable: a value the device didn't capture is
 *   NULL, never 0. Range CHECKs reject physically implausible numbers.
 */

const ts = (col: string) =>
  `${col} TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ${col}) IS ${col})`;
const tsNullable = (col: string) =>
  `${col} TEXT CHECK (${col} IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', ${col}) IS ${col})`;
const date = (col: string, nullable = false) =>
  nullable
    ? `${col} TEXT CHECK (${col} IS NULL OR date(${col}) IS ${col})`
    : `${col} TEXT NOT NULL CHECK (date(${col}) IS ${col})`;
const source = `source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','imported','sample'))`;
const bool = (col: string, dflt: 0 | 1) => `${col} INTEGER NOT NULL DEFAULT ${dflt} CHECK (${col} IN (0,1))`;
const range = (col: string, min: number, max: number) =>
  `${col} REAL CHECK (${col} IS NULL OR ${col} BETWEEN ${min} AND ${max})`;

const SQL = /* sql */ `
-- ─── Player ────────────────────────────────────────────────────────────────
CREATE TABLE player_profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  display_name    TEXT    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  handedness      TEXT    NOT NULL DEFAULT 'right' CHECK (handedness IN ('right','left')),
  handicap_index  REAL    CHECK (handicap_index IS NULL OR handicap_index BETWEEN -10 AND 54),
  distance_unit   TEXT    NOT NULL DEFAULT 'yards' CHECK (distance_unit IN ('yards','metres')),
  speed_unit      TEXT    NOT NULL DEFAULT 'mph'   CHECK (speed_unit IN ('mph','kmh','mps')),
  ${ts('updated_at')}
) STRICT;
INSERT INTO player_profile (id) VALUES (1);

-- ─── Equipment ─────────────────────────────────────────────────────────────
CREATE TABLE club (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('driver','wood','hybrid','iron','wedge','putter')),
  label           TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  make            TEXT    CHECK (make IS NULL OR length(make) <= 60),
  model           TEXT    CHECK (model IS NULL OR length(model) <= 80),
  ${range('loft_deg', 0, 70)},
  ${range('lie_deg', 40, 80)},
  ${range('length_m', 0.6, 1.25)},
  shaft_make      TEXT    CHECK (shaft_make IS NULL OR length(shaft_make) <= 60),
  shaft_model     TEXT    CHECK (shaft_model IS NULL OR length(shaft_model) <= 80),
  shaft_flex      TEXT    CHECK (shaft_flex IS NULL OR shaft_flex IN ('L','A','R','S','X','TX')),
  ${range('shaft_weight_g', 30, 150)},
  swing_weight    TEXT    CHECK (swing_weight IS NULL OR swing_weight GLOB '[A-G][0-9]*'),
  grip            TEXT    CHECK (grip IS NULL OR length(grip) <= 80),
  ${date('acquired_on', true)},
  ${date('retired_on', true)},
  notes           TEXT    CHECK (notes IS NULL OR length(notes) <= 2000),
  ${source},
  ${ts('created_at')},
  ${ts('updated_at')},
  CHECK (retired_on IS NULL OR acquired_on IS NULL OR retired_on >= acquired_on)
) STRICT;

CREATE TABLE bag (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  ${bool('is_active', 0)},
  ${source},
  ${ts('created_at')}
) STRICT;
-- At most one active bag.
CREATE UNIQUE INDEX bag_one_active ON bag (is_active) WHERE is_active = 1;

CREATE TABLE bag_club (
  bag_id          INTEGER NOT NULL REFERENCES bag(id)  ON DELETE CASCADE,
  club_id         INTEGER NOT NULL REFERENCES club(id) ON DELETE CASCADE,
  slot            INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 14),
  PRIMARY KEY (bag_id, club_id),
  UNIQUE (bag_id, slot)
) STRICT;
CREATE INDEX bag_club_club ON bag_club (club_id);

-- Rule 4.1b: a player may carry at most 14 clubs.
CREATE TRIGGER bag_club_limit BEFORE INSERT ON bag_club
WHEN (SELECT count(*) FROM bag_club WHERE bag_id = NEW.bag_id) >= 14
BEGIN
  SELECT RAISE(ABORT, 'A bag can hold at most 14 clubs');
END;

-- ─── Courses ───────────────────────────────────────────────────────────────
CREATE TABLE course (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  location        TEXT    CHECK (location IS NULL OR length(location) <= 120),
  notes           TEXT    CHECK (notes IS NULL OR length(notes) <= 2000),
  ${source},
  ${ts('created_at')}
) STRICT;

CREATE TABLE course_tee (
  id              INTEGER PRIMARY KEY,
  course_id       INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  -- Rating and slope are as published on the player's scorecard; NULL if unknown.
  ${range('course_rating', 50, 85)},
  slope_rating    INTEGER CHECK (slope_rating IS NULL OR slope_rating BETWEEN 55 AND 155),
  UNIQUE (course_id, name)
) STRICT;

CREATE TABLE hole (
  id              INTEGER PRIMARY KEY,
  course_id       INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL CHECK (number BETWEEN 1 AND 18),
  par             INTEGER NOT NULL CHECK (par BETWEEN 3 AND 6),
  stroke_index    INTEGER CHECK (stroke_index IS NULL OR stroke_index BETWEEN 1 AND 18),
  -- Layout for the 3D visualizer, validated by HoleGeometry (Zod) on write.
  geometry        TEXT    CHECK (geometry IS NULL OR json_valid(geometry)),
  UNIQUE (course_id, number)
) STRICT;
CREATE UNIQUE INDEX hole_stroke_index ON hole (course_id, stroke_index) WHERE stroke_index IS NOT NULL;

CREATE TABLE hole_length (
  tee_id          INTEGER NOT NULL REFERENCES course_tee(id) ON DELETE CASCADE,
  hole_id         INTEGER NOT NULL REFERENCES hole(id)       ON DELETE CASCADE,
  length_m        REAL    NOT NULL CHECK (length_m BETWEEN 50 AND 750),
  PRIMARY KEY (tee_id, hole_id)
) STRICT;

-- ─── Rounds ────────────────────────────────────────────────────────────────
CREATE TABLE round (
  id              INTEGER PRIMARY KEY,
  course_id       INTEGER NOT NULL REFERENCES course(id) ON DELETE RESTRICT,
  tee_id          INTEGER REFERENCES course_tee(id) ON DELETE SET NULL,
  ${date('played_on')},
  holes_planned   INTEGER NOT NULL DEFAULT 18 CHECK (holes_planned IN (9,18)),
  start_hole      INTEGER NOT NULL DEFAULT 1  CHECK (start_hole IN (1,10)),
  conditions      TEXT    CHECK (conditions IS NULL OR length(conditions) <= 200),
  notes           TEXT    CHECK (notes IS NULL OR length(notes) <= 2000),
  ${tsNullable('completed_at')},
  ${source},
  ${ts('created_at')}
) STRICT;
CREATE INDEX round_played_on ON round (played_on DESC);
CREATE INDEX round_course ON round (course_id);

CREATE TABLE hole_score (
  id              INTEGER PRIMARY KEY,
  round_id        INTEGER NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  hole_id         INTEGER NOT NULL REFERENCES hole(id)  ON DELETE RESTRICT,
  strokes         INTEGER NOT NULL CHECK (strokes BETWEEN 1 AND 20),
  putts           INTEGER CHECK (putts IS NULL OR putts BETWEEN 0 AND 10),
  -- Tee-shot outcome on par 4/5; NULL on par 3s or when not recorded.
  fairway         TEXT    CHECK (fairway IS NULL OR fairway IN ('hit','left','right','short','long')),
  penalties       INTEGER NOT NULL DEFAULT 0 CHECK (penalties BETWEEN 0 AND 10),
  sand_shots      INTEGER NOT NULL DEFAULT 0 CHECK (sand_shots BETWEEN 0 AND 10),
  ${range('first_putt_m', 0, 60)},
  UNIQUE (round_id, hole_id),
  CHECK (putts IS NULL OR putts <= strokes),
  CHECK (penalties + coalesce(putts, 0) <= strokes)
) STRICT;
CREATE INDEX hole_score_hole ON hole_score (hole_id);

-- ─── Shots ─────────────────────────────────────────────────────────────────
CREATE TABLE session (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL CHECK (kind IN ('range','simulator','course','practice')),
  ${ts('started_at')},
  location        TEXT    CHECK (location IS NULL OR length(location) <= 120),
  -- Launch monitor or app the numbers came from, as the player names it.
  device          TEXT    CHECK (device IS NULL OR length(device) <= 80),
  round_id        INTEGER REFERENCES round(id) ON DELETE CASCADE,
  notes           TEXT    CHECK (notes IS NULL OR length(notes) <= 2000),
  ${source},
  ${ts('created_at')},
  CHECK (kind = 'course' OR round_id IS NULL)
) STRICT;
CREATE INDEX session_started ON session (started_at DESC);

CREATE TABLE shot (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  club_id         INTEGER NOT NULL REFERENCES club(id)    ON DELETE RESTRICT,
  seq             INTEGER NOT NULL CHECK (seq >= 1),
  hole_score_id   INTEGER REFERENCES hole_score(id) ON DELETE SET NULL,
  lie             TEXT    CHECK (lie IS NULL OR lie IN ('tee','fairway','rough','sand','recovery','fringe','green','mat')),
  ${range('carry_m', 0, 400)},
  ${range('total_m', 0, 450)},
  ${range('offline_m', -150, 150)},          -- signed: + right of target
  ${range('ball_speed_mps', 0, 95)},
  ${range('club_speed_mps', 0, 65)},
  ${range('launch_deg', -10, 70)},
  ${range('launch_dir_deg', -45, 45)},
  ${range('spin_rpm', 0, 15000)},
  ${range('spin_axis_deg', -90, 90)},
  ${range('apex_m', 0, 80)},
  ${range('descent_deg', 0, 90)},
  ${range('attack_deg', -15, 15)},
  ${range('club_path_deg', -20, 20)},
  ${range('face_angle_deg', -20, 20)},
  -- On-course position in the hole's local frame (see HoleGeometry): metres,
  -- origin at the tee, +y toward the green, +x right. Only with hole_score_id.
  ${range('start_x_m', -250, 250)},
  ${range('start_y_m', -100, 800)},
  ${range('end_x_m', -250, 250)},
  ${range('end_y_m', -100, 800)},
  -- Player flags a mishit so it stays on record but out of averages.
  ${bool('excluded', 0)},
  ${source},
  ${ts('created_at')},
  UNIQUE (session_id, seq),
  CHECK (total_m IS NULL OR carry_m IS NULL OR total_m >= carry_m),
  CHECK ((start_x_m IS NULL) = (start_y_m IS NULL) AND (end_x_m IS NULL) = (end_y_m IS NULL)),
  CHECK (start_x_m IS NULL OR hole_score_id IS NOT NULL)
) STRICT;
CREATE INDEX shot_club ON shot (club_id);
CREATE INDEX shot_hole_score ON shot (hole_score_id) WHERE hole_score_id IS NOT NULL;

-- ─── Practice ──────────────────────────────────────────────────────────────
CREATE TABLE drill (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
  category        TEXT    NOT NULL CHECK (category IN ('driving','approach','short_game','putting','full_swing')),
  description     TEXT    NOT NULL CHECK (length(description) <= 2000),
  -- What the player records after doing it, e.g. 'putts holed of 10'.
  result_label    TEXT    CHECK (result_label IS NULL OR length(result_label) <= 60),
  ${bool('higher_is_better', 1)},
  ${bool('builtin', 0)},
  ${ts('created_at')}
) STRICT;

CREATE TABLE practice_plan (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  focus           TEXT    CHECK (focus IS NULL OR length(focus) <= 200),
  ${date('scheduled_for', true)},
  status          TEXT    NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped')),
  ${source},
  ${ts('created_at')}
) STRICT;

CREATE TABLE practice_plan_item (
  plan_id         INTEGER NOT NULL REFERENCES practice_plan(id) ON DELETE CASCADE,
  drill_id        INTEGER NOT NULL REFERENCES drill(id)         ON DELETE RESTRICT,
  position        INTEGER NOT NULL CHECK (position >= 1),
  minutes         INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 240),
  PRIMARY KEY (plan_id, position)
) STRICT;

CREATE TABLE practice_log (
  id              INTEGER PRIMARY KEY,
  drill_id        INTEGER NOT NULL REFERENCES drill(id)          ON DELETE RESTRICT,
  plan_id         INTEGER REFERENCES practice_plan(id)           ON DELETE SET NULL,
  ${date('performed_on')},
  minutes         INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 480),
  result          REAL,
  notes           TEXT    CHECK (notes IS NULL OR length(notes) <= 2000),
  ${source},
  ${ts('created_at')}
) STRICT;
CREATE INDEX practice_log_drill ON practice_log (drill_id, performed_on);

-- ─── Intelligence ──────────────────────────────────────────────────────────
-- Insights are computed on demand from the tables above and never stored.
-- Only the player's decision to hide one persists.
CREATE TABLE insight_dismissal (
  insight_key     TEXT    PRIMARY KEY CHECK (length(insight_key) BETWEEN 1 AND 200),
  ${ts('dismissed_at')}
) STRICT;
`;

export const m0001: Migration = {
  id: 1,
  name: 'initial_schema',
  up: (db) => db.exec(SQL),
};
