import {
  ClubInput,
  HoleGeometry,
  ShotMetrics,
  type ClubKind,
  type FairwayResult,
} from '@shared/schemas';
import type { DB } from '../connection';
import { generateHoleGeometry, pointAlong, polylineLength, type Pt } from './geometry';
import { clamp, createRng, round0, round1, type Rng } from './random';

/*
 * Sample data for exploring Clubhouse before recording your own.
 *
 * Every row is written with source = 'sample' and is removed by
 * clearSampleData(). Values are synthesised from simple models of a
 * mid-handicap player; they are illustrative, not measurements of anyone.
 * Clubs are generic (no make/model) and the course is fictional.
 */

const SEED = 0x5eed_c1b;
const DAY_MS = 86_400_000;

interface ClubProfile {
  label: string;
  kind: ClubKind;
  loftDeg: number;
  lengthM: number | null;
  carryM: number;
  rollM: number;
  clubSpeedMps: number;
  smash: number;
  launchDeg: number;
  spinRpm: number;
  /** Multiplier on face/path variability: longer clubs scatter more. */
  scatter: number;
}

const PROFILES: readonly ClubProfile[] = [
  { label: 'Driver', kind: 'driver', loftDeg: 10.5, lengthM: 1.156, carryM: 205, rollM: 19, clubSpeedMps: 42, smash: 1.45, launchDeg: 13, spinRpm: 2900, scatter: 1.7 },
  { label: '3 Wood', kind: 'wood', loftDeg: 15, lengthM: 1.092, carryM: 186, rollM: 13, clubSpeedMps: 40, smash: 1.42, launchDeg: 11, spinRpm: 3700, scatter: 1.45 },
  { label: '5 Wood', kind: 'wood', loftDeg: 18, lengthM: 1.067, carryM: 174, rollM: 10, clubSpeedMps: 39, smash: 1.4, launchDeg: 12, spinRpm: 4300, scatter: 1.35 },
  { label: '4 Hybrid', kind: 'hybrid', loftDeg: 21, lengthM: 1.029, carryM: 163, rollM: 8, clubSpeedMps: 38, smash: 1.37, launchDeg: 13, spinRpm: 4600, scatter: 1.25 },
  { label: '5 Iron', kind: 'iron', loftDeg: 24, lengthM: 0.965, carryM: 152, rollM: 7, clubSpeedMps: 37, smash: 1.33, launchDeg: 13.5, spinRpm: 5000, scatter: 1.2 },
  { label: '6 Iron', kind: 'iron', loftDeg: 27, lengthM: 0.953, carryM: 143, rollM: 6, clubSpeedMps: 36, smash: 1.32, launchDeg: 15, spinRpm: 5600, scatter: 1.1 },
  { label: '7 Iron', kind: 'iron', loftDeg: 31, lengthM: 0.94, carryM: 133, rollM: 5, clubSpeedMps: 35, smash: 1.31, launchDeg: 17, spinRpm: 6300, scatter: 1 },
  { label: '8 Iron', kind: 'iron', loftDeg: 35, lengthM: 0.927, carryM: 122, rollM: 4, clubSpeedMps: 34, smash: 1.29, launchDeg: 19, spinRpm: 7100, scatter: 0.95 },
  { label: '9 Iron', kind: 'iron', loftDeg: 40, lengthM: 0.914, carryM: 111, rollM: 3, clubSpeedMps: 33, smash: 1.27, launchDeg: 22, spinRpm: 7900, scatter: 0.9 },
  { label: 'Pitching Wedge', kind: 'wedge', loftDeg: 45, lengthM: 0.902, carryM: 100, rollM: 3, clubSpeedMps: 32, smash: 1.24, launchDeg: 25, spinRpm: 8500, scatter: 0.85 },
  { label: 'Gap Wedge', kind: 'wedge', loftDeg: 50, lengthM: 0.895, carryM: 88, rollM: 2, clubSpeedMps: 31, smash: 1.2, launchDeg: 28, spinRpm: 9000, scatter: 0.8 },
  { label: 'Sand Wedge', kind: 'wedge', loftDeg: 54, lengthM: 0.889, carryM: 75, rollM: 2, clubSpeedMps: 30, smash: 1.16, launchDeg: 31, spinRpm: 9400, scatter: 0.75 },
  { label: 'Lob Wedge', kind: 'wedge', loftDeg: 58, lengthM: 0.889, carryM: 60, rollM: 1, clubSpeedMps: 28, smash: 1.1, launchDeg: 34, spinRpm: 9600, scatter: 0.7 },
  { label: 'Putter', kind: 'putter', loftDeg: 3, lengthM: 0.876, carryM: 0, rollM: 0, clubSpeedMps: 0, smash: 0, launchDeg: 0, spinRpm: 0, scatter: 0 },
];

const PARS = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4] as const;
const STROKE_INDEX = [7, 3, 15, 1, 11, 17, 9, 5, 13, 8, 16, 2, 10, 4, 18, 12, 6, 14] as const;

const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
};
const rad = (deg: number): number => (deg * Math.PI) / 180;
const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const isoTs = (ms: number): string => new Date(ms).toISOString();
const id = (r: { lastInsertRowid: number | bigint }): number => Number(r.lastInsertRowid);

// ─── Launch-monitor shot model ──────────────────────────────────────────────

type Metrics = ShotMetrics;

const EMPTY_METRICS: Metrics = {
  carryM: null, totalM: null, offlineM: null, ballSpeedMps: null, clubSpeedMps: null,
  launchDeg: null, launchDirDeg: null, spinRpm: null, spinAxisDeg: null, apexM: null,
  descentDeg: null, attackDeg: null, clubPathDeg: null, faceAngleDeg: null,
};

function rangeShot(rng: Rng, p: ClubProfile, fullDevice: boolean, form: number): { metrics: Metrics; excluded: boolean } {
  const mishit = rng.next() < 0.07;
  const quality = mishit ? rng.range(0.62, 0.82) : 1 + rng.normal() * 0.035 + form;
  const clubSpeed = p.clubSpeedMps * (1 + rng.normal() * 0.02);
  const smash = p.smash * (mishit ? rng.range(0.85, 0.93) : 1 + rng.normal() * 0.008);
  const carry = p.carryM * quality;

  const path = -1.5 + rng.normal() * 1.8 * p.scatter;
  const face = 0.3 + rng.normal() * 1.6 * p.scatter;
  const launchDir = 0.75 * face + 0.25 * path;
  const spinAxis = clamp((face - path) * 3.5 + rng.normal() * 1.5, -40, 40);
  const offline = carry * (Math.sin(rad(launchDir)) + spinAxis * 0.006);
  const launch = p.launchDeg + rng.normal() * 1.2 - (mishit ? 2.5 : 0);
  const spin = p.spinRpm * (1 + rng.normal() * 0.08);
  const attack =
    p.kind === 'driver' ? 1 + rng.normal() * 1.5 : p.kind === 'wedge' ? -4.5 + rng.normal() : -3.5 + rng.normal() * 1.2;
  const total = carry + Math.max(0, p.rollM * (1 + rng.normal() * 0.3));

  const metrics: Metrics = {
    ...EMPTY_METRICS,
    carryM: round1(carry),
    totalM: round1(Math.max(total, carry)),
    offlineM: round1(clamp(offline, -150, 150)),
    ballSpeedMps: round1(clubSpeed * smash),
    launchDeg: round1(launch),
    spinRpm: round0(spin),
  };
  if (fullDevice) {
    Object.assign(metrics, {
      clubSpeedMps: round1(clubSpeed),
      launchDirDeg: round1(launchDir),
      spinAxisDeg: round1(spinAxis),
      apexM: round1(carry * Math.tan(rad(launch)) * 0.62),
      descentDeg: round1(clamp(16 + launch * 1.6 + spin / 1250, 25, 58)),
      attackDeg: round1(clamp(attack, -15, 15)),
      clubPathDeg: round1(clamp(path, -20, 20)),
      faceAngleDeg: round1(clamp(face, -20, 20)),
    } satisfies Partial<Metrics>);
  }
  // Players typically flag about half their obvious mishits.
  return { metrics: ShotMetrics.parse(metrics), excluded: mishit && rng.next() < 0.5 };
}

// ─── Scoring model ──────────────────────────────────────────────────────────

interface HoleRow {
  id: number;
  number: number;
  par: number;
  strokeIndex: number;
  geometry: HoleGeometry;
}

interface ScoreDraft {
  strokes: number;
  putts: number;
  fairway: FairwayResult | null;
  penalties: number;
  sandShots: number;
  firstPuttM: number;
}

function draftScore(rng: Rng, hole: HoleRow, improvement: number): ScoreDraft {
  const difficulty = (9.5 - hole.strokeIndex) / 9; // +1 hardest … −1 easiest
  const shift = difficulty * 0.12 - improvement * 0.1;
  const rel = rng.weighted<number>([
    [-1, Math.max(0.01, (hole.par === 3 ? 0.03 : 0.05) - shift * 0.1)],
    [0, Math.max(0.05, 0.33 - shift)],
    [1, 0.4],
    [2, Math.max(0.03, 0.16 + shift * 0.7)],
    [3, Math.max(0.01, 0.06 + shift * 0.3)],
  ]);
  const strokes = hole.par + rel;
  let putts = rng.weighted<number>([[0, 0.02], [1, 0.18], [2, 0.62], [3, 0.16], [4, 0.02]]);
  putts = Math.min(putts, strokes - 1);
  let penalties = rel >= 2 && rng.next() < 0.35 ? 1 : 0;
  if (penalties + putts > strokes - 1) penalties = 0;
  const nonPutt = strokes - putts - penalties;
  const sandShots = nonPutt >= 2 && rng.next() < 0.12 ? 1 : 0;
  const gir = strokes - putts <= hole.par - 2;
  const fairway =
    hole.par >= 4
      ? rng.weighted<FairwayResult>([['hit', 0.48], ['left', 0.2], ['right', 0.26], ['short', 0.06]])
      : null;
  const firstPuttM = putts === 0 ? 0 : round1(gir ? rng.range(3, 13) : rng.range(0.8, 5));
  return { strokes, putts, fairway, penalties, sandShots, firstPuttM: Math.min(firstPuttM, hole.geometry.green.radiusM * 1.4) };
}

// ─── On-course shot tracks ──────────────────────────────────────────────────

interface TrackedShot {
  club: ClubProfile;
  lie: 'tee' | 'fairway' | 'rough' | 'sand' | 'green';
  start: Pt;
  end: Pt;
}

function clubFor(distanceM: number, allowDriver: boolean): ClubProfile {
  const candidates = PROFILES.filter((p) => p.kind !== 'putter' && (allowDriver || p.kind !== 'driver'));
  return candidates.reduce((best, p) =>
    Math.abs(p.carryM + p.rollM - distanceM) < Math.abs(best.carryM + best.rollM - distanceM) ? p : best,
  );
}

function trackHole(rng: Rng, hole: HoleRow, score: ScoreDraft): TrackedShot[] {
  const g = hole.geometry;
  const line = g.centerline as readonly Pt[];
  const length = polylineLength(line);
  const pin: Pt = [
    g.green.center[0] + rng.range(-0.4, 0.4) * g.green.radiusM,
    g.green.center[1] + rng.range(-0.4, 0.4) * g.green.radiusM,
  ];
  const nonPutt = score.strokes - score.putts - score.penalties;
  const shots: TrackedShot[] = [];
  let pos: Pt = [0, 0];
  let s = 0;
  const halfWidth = g.fairwayWidthM / 2;

  for (let k = 1; k <= nonPutt; k++) {
    const isLast = k === nonPutt;
    let end: Pt;
    if (isLast) {
      const angle = rng.range(0, Math.PI * 2);
      end = [pin[0] + Math.cos(angle) * score.firstPuttM, pin[1] + Math.sin(angle) * score.firstPuttM];
    } else {
      const remaining = length - s;
      const shotsLeft = nonPutt - k + 1;
      const teeDrive = k === 1 && hole.par >= 4;
      const travel = teeDrive
        ? Math.min(remaining * 0.8, 224 + rng.normal() * 16)
        : (remaining / shotsLeft) * rng.range(0.75, 1.15);
      s = Math.min(length - 15, s + travel);
      const { p, normal } = pointAlong(line, s);
      let lateral = rng.normal() * halfWidth * 0.45;
      if (k === 1 && score.fairway === 'left') lateral = -(halfWidth + rng.range(3, 15));
      if (k === 1 && score.fairway === 'right') lateral = halfWidth + rng.range(3, 15);
      if (k === 1 && score.fairway === 'hit') lateral = clamp(lateral, -halfWidth * 0.8, halfWidth * 0.8);
      end = [p[0] + normal[0] * lateral, p[1] + normal[1] * lateral];
    }
    const travelled = Math.hypot(end[0] - pos[0], end[1] - pos[1]);
    const prev = shots.at(-1);
    const lie: TrackedShot['lie'] =
      k === 1
        ? 'tee'
        : score.sandShots > 0 && isLast
          ? 'sand'
          : prev && Math.abs(pointLateral(line, prev.end)) <= halfWidth
            ? 'fairway'
            : 'rough';
    shots.push({ club: clubFor(travelled, k === 1), lie, start: pos, end });
    pos = end;
  }

  const putter = at(PROFILES, PROFILES.length - 1);
  let d = score.firstPuttM;
  for (let k = 1; k <= score.putts; k++) {
    const isLast = k === score.putts;
    d = isLast ? 0 : d * rng.range(0.05, 0.2);
    const angle = rng.range(0, Math.PI * 2);
    const end: Pt = isLast ? pin : [pin[0] + Math.cos(angle) * d, pin[1] + Math.sin(angle) * d];
    shots.push({ club: putter, lie: 'green', start: pos, end });
    pos = end;
  }
  return shots;
}

/** Signed lateral distance of a point from the nearest centreline segment. */
function pointLateral(line: readonly Pt[], p: Pt): number {
  let best = Infinity;
  let sign = 1;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (!a || !b) continue;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    const t = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2, 0, 1);
    const cx = a[0] + vx * t;
    const cy = a[1] + vy * t;
    const dd = Math.hypot(p[0] - cx, p[1] - cy);
    if (dd < best) {
      best = dd;
      sign = vx * (p[1] - a[1]) - vy * (p[0] - a[0]) > 0 ? -1 : 1;
    }
  }
  return best * sign;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SampleCounts {
  clubs: number;
  bags: number;
  courses: number;
  rounds: number;
  sessions: number;
  shots: number;
  practicePlans: number;
  practiceLogs: number;
}

const COUNT_TABLES: Record<keyof SampleCounts, string> = {
  clubs: 'club',
  bags: 'bag',
  courses: 'course',
  rounds: 'round',
  sessions: 'session',
  shots: 'shot',
  practicePlans: 'practice_plan',
  practiceLogs: 'practice_log',
};

export function countBySource(db: DB, source: 'sample' | 'own'): SampleCounts {
  const where = source === 'sample' ? "source = 'sample'" : "source <> 'sample'";
  const out = {} as SampleCounts;
  for (const [key, table] of Object.entries(COUNT_TABLES) as [keyof SampleCounts, string][]) {
    out[key] = db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get()?.n ?? 0;
  }
  return out;
}

export const hasSampleData = (db: DB): boolean =>
  Object.values(countBySource(db, 'sample')).some((n) => n > 0);

/**
 * Writes the full sample dataset dated relative to `now`. Throws if sample
 * data is already present. Runs in one transaction: all or nothing.
 */
export function loadSampleData(db: DB, now: Date = new Date()): SampleCounts {
  if (hasSampleData(db)) throw new Error('Sample data is already loaded');
  const rng = createRng(SEED);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  db.transaction(() => {
    // ── Clubs and bag
    const insClub = db.prepare(
      `INSERT INTO club (kind, label, loft_deg, length_m, shaft_flex, acquired_on, retired_on, notes, source)
       VALUES (@kind, @label, @loftDeg, @lengthM, @shaftFlex, @acquiredOn, @retiredOn, @notes, 'sample')`,
    );
    const clubId = new Map<string, number>();
    const writeClub = (c: { kind: ClubKind; label: string; loftDeg: number; lengthM: number | null; acquiredOn: string; retiredOn: string | null; notes: string | null }) => {
      const input = ClubInput.parse({
        ...c,
        make: null, model: null, lieDeg: null, shaftMake: null, shaftModel: null,
        shaftFlex: c.kind === 'putter' ? null : 'R', shaftWeightG: null, swingWeight: null, grip: null,
      });
      return id(insClub.run({ ...input, shaftFlex: input.shaftFlex }));
    };
    for (const p of PROFILES) {
      clubId.set(p.label, writeClub({ kind: p.kind, label: p.label, loftDeg: p.loftDeg, lengthM: p.lengthM, acquiredOn: isoDate(today - 400 * DAY_MS), retiredOn: null, notes: null }));
    }
    writeClub({ kind: 'hybrid', label: '3 Hybrid', loftDeg: 19, lengthM: 1.041, acquiredOn: isoDate(today - 1500 * DAY_MS), retiredOn: isoDate(today - 400 * DAY_MS), notes: 'Replaced by the 5 Wood.' });

    const hasActive = db.prepare('SELECT 1 FROM bag WHERE is_active = 1').get() !== undefined;
    const bagId = id(db.prepare("INSERT INTO bag (name, is_active, source) VALUES ('Sample bag', ?, 'sample')").run(hasActive ? 0 : 1));
    const insSlot = db.prepare('INSERT INTO bag_club (bag_id, club_id, slot) VALUES (?, ?, ?)');
    PROFILES.forEach((p, i) => insSlot.run(bagId, clubId.get(p.label), i + 1));

    // ── Course
    const courseId = id(db.prepare(
      "INSERT INTO course (name, location, notes, source) VALUES ('Cedar Hollow Golf Club', 'Fictional sample course', 'Layout generated for sample data.', 'sample')",
    ).run());
    const insTee = db.prepare('INSERT INTO course_tee (course_id, name, course_rating, slope_rating) VALUES (?, ?, ?, ?)');
    const whiteTee = id(insTee.run(courseId, 'White', 69.4, 122));
    const blueTee = id(insTee.run(courseId, 'Blue', 71.2, 128));
    const insHole = db.prepare('INSERT INTO hole (course_id, number, par, stroke_index, geometry) VALUES (?, ?, ?, ?, ?)');
    const insLen = db.prepare('INSERT INTO hole_length (tee_id, hole_id, length_m) VALUES (?, ?, ?)');
    const holes: HoleRow[] = PARS.map((par, i) => {
      const white = round0(par === 3 ? rng.range(135, 170) : par === 4 ? rng.range(300, 375) : rng.range(430, 480));
      const geometry = HoleGeometry.parse(generateHoleGeometry(rng, par, white));
      const holeId = id(insHole.run(courseId, i + 1, par, at(STROKE_INDEX, i), JSON.stringify(geometry)));
      insLen.run(whiteTee, holeId, white);
      insLen.run(blueTee, holeId, round0(white * rng.range(1.05, 1.08)));
      return { id: holeId, number: i + 1, par, strokeIndex: at(STROKE_INDEX, i), geometry };
    });

    // ── Rounds (oldest first) with hole scores; the latest four have shot tracks
    const insRound = db.prepare(
      `INSERT INTO round (course_id, tee_id, played_on, holes_planned, start_hole, conditions, completed_at, source)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'sample')`,
    );
    const insScore = db.prepare(
      `INSERT INTO hole_score (round_id, hole_id, strokes, putts, fairway, penalties, sand_shots, first_putt_m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insSession = db.prepare(
      "INSERT INTO session (kind, started_at, location, device, round_id, notes, source) VALUES (?, ?, ?, ?, ?, ?, 'sample')",
    );
    const insShot = db.prepare(
      `INSERT INTO shot (session_id, club_id, seq, hole_score_id, lie, carry_m, total_m, offline_m, ball_speed_mps,
         club_speed_mps, launch_deg, launch_dir_deg, spin_rpm, spin_axis_deg, apex_m, descent_deg, attack_deg,
         club_path_deg, face_angle_deg, start_x_m, start_y_m, end_x_m, end_y_m, excluded, source)
       VALUES (@sessionId, @clubId, @seq, @holeScoreId, @lie, @carryM, @totalM, @offlineM, @ballSpeedMps,
         @clubSpeedMps, @launchDeg, @launchDirDeg, @spinRpm, @spinAxisDeg, @apexM, @descentDeg, @attackDeg,
         @clubPathDeg, @faceAngleDeg, @sx, @sy, @ex, @ey, @excluded, 'sample')`,
    );

    const ROUNDS = 14;
    const conditions = ['Calm, firm fairways', 'Breezy', 'Soft after rain', 'Warm, light wind', 'Cool morning'];
    for (let r = 0; r < ROUNDS; r++) {
      const daysAgo = Math.round(150 - (r * 146) / (ROUNDS - 1));
      const dayMs = today - daysAgo * DAY_MS;
      const nine = r === 5;
      const tracked = r >= ROUNDS - 4;
      const improvement = r / (ROUNDS - 1);
      const roundId = id(insRound.run(courseId, whiteTee, isoDate(dayMs), nine ? 9 : 18, rng.pick(conditions), isoTs(dayMs + 13 * 3600_000)));
      const sessionId = tracked ? id(insSession.run('course', isoTs(dayMs + 8.5 * 3600_000), 'Cedar Hollow Golf Club', null, roundId, null)) : null;
      let seq = 1;
      for (const hole of holes.slice(0, nine ? 9 : 18)) {
        const sc = draftScore(rng, hole, improvement);
        const scoreId = id(insScore.run(roundId, hole.id, sc.strokes, sc.putts, sc.fairway, sc.penalties, sc.sandShots, sc.putts === 0 ? null : sc.firstPuttM));
        if (sessionId === null) continue;
        for (const t of trackHole(rng, hole, sc)) {
          const travelled = Math.hypot(t.end[0] - t.start[0], t.end[1] - t.start[1]);
          insShot.run({
            ...EMPTY_METRICS,
            totalM: round1(Math.min(450, travelled)),
            sessionId, clubId: clubId.get(t.club.label), seq: seq++, holeScoreId: scoreId, lie: t.lie,
            sx: round1(t.start[0]), sy: round1(t.start[1]), ex: round1(t.end[0]), ey: round1(t.end[1]),
            excluded: 0,
          });
        }
      }
    }

    // ── Range and simulator sessions
    const longGame = ['Driver', '3 Wood', '5 Wood', '4 Hybrid'];
    const irons = ['5 Iron', '6 Iron', '7 Iron', '8 Iron', '9 Iron'];
    const wedges = ['Pitching Wedge', 'Gap Wedge', 'Sand Wedge', 'Lob Wedge'];
    const SESSIONS = 12;
    for (let s = 0; s < SESSIONS; s++) {
      const daysAgo = Math.round(120 - (s * 116) / (SESSIONS - 1)) + 2;
      const fullDevice = s % 3 !== 1;
      const sessionId = id(insSession.run(
        fullDevice ? 'simulator' : 'range',
        isoTs(today - daysAgo * DAY_MS + 17.5 * 3600_000),
        fullDevice ? 'Home simulator' : 'Driving range',
        fullDevice ? 'Launch monitor (full club data)' : 'Range ball tracker',
        null, null,
      ));
      const form = (s / SESSIONS) * 0.015;
      const clubs = [rng.pick(longGame), rng.pick(irons), rng.pick(irons), rng.pick(wedges), s % 2 === 0 ? 'Driver' : '7 Iron'];
      let seq = 1;
      for (const label of new Set(clubs)) {
        const profile = PROFILES.find((p) => p.label === label);
        if (!profile) continue;
        for (let n = rng.int(8, 13); n > 0; n--) {
          const { metrics, excluded } = rangeShot(rng, profile, fullDevice, form);
          insShot.run({
            ...metrics, sessionId, clubId: clubId.get(label), seq: seq++, holeScoreId: null, lie: 'mat',
            sx: null, sy: null, ex: null, ey: null, excluded: excluded ? 1 : 0,
          });
        }
      }
    }

    // ── Practice
    const drillId = (name: string): number => {
      const row = db.prepare<[string], { id: number }>('SELECT id FROM drill WHERE name = ?').get(name);
      if (!row) throw new Error(`Built-in drill "${name}" missing`);
      return row.id;
    };
    const insPlan = db.prepare("INSERT INTO practice_plan (name, focus, scheduled_for, status, source) VALUES (?, ?, ?, ?, 'sample')");
    const insItem = db.prepare('INSERT INTO practice_plan_item (plan_id, drill_id, position, minutes) VALUES (?, ?, ?, ?)');
    const donePlan = id(insPlan.run('Putting tune-up', 'Speed control from long range', isoDate(today - 16 * DAY_MS), 'done'));
    [['Lag ladder', 20], ['Gate putting', 15], ['Clock drill', 15]].forEach(([n, m], i) => insItem.run(donePlan, drillId(String(n)), i + 1, m));
    const nextPlan = id(insPlan.run('Wedge distances', 'Tighten carry control inside 90 m', isoDate(today + 3 * DAY_MS), 'planned'));
    [['Wedge distance ladder', 30], ['Up-and-down nine', 25]].forEach(([n, m], i) => insItem.run(nextPlan, drillId(String(n)), i + 1, m));

    const insLog = db.prepare(
      "INSERT INTO practice_log (drill_id, plan_id, performed_on, minutes, result, source) VALUES (?, ?, ?, ?, ?, 'sample')",
    );
    const logs: [string, number, number][] = [
      ['Gate putting', 10, 6], ['Lag ladder', 10, 5], ['Up-and-down nine', 9, 3], ['Fairway finder', 10, 5],
      ['Wedge distance ladder', 12, 4], ['Bunker splash', 10, 6], ['Clock drill', 12, 5], ['Nine-shot iron drill', 9, 4],
    ];
    for (let i = 0; i < 16; i++) {
      const [name, max, base] = at(logs, i % logs.length);
      const daysAgo = 70 - i * 4;
      const result = clamp(Math.round(base + (i / 16) * 2 + rng.normal() * 1.2), 0, max);
      insLog.run(drillId(name), daysAgo === 16 ? donePlan : null, isoDate(today - daysAgo * DAY_MS), rng.pick([15, 20, 25, 30]), result);
    }
  })();

  return countBySource(db, 'sample');
}

export interface ClearSampleResult {
  removed: SampleCounts;
  /** Sample rows kept because your own data now references them. */
  kept: SampleCounts;
}

/** Removes sample rows, keeping any your own records depend on. */
export function clearSampleData(db: DB): ClearSampleResult {
  const before = countBySource(db, 'sample');
  db.transaction(() => {
    db.exec(`
      DELETE FROM practice_log  WHERE source = 'sample';
      DELETE FROM practice_plan WHERE source = 'sample'
        AND NOT EXISTS (SELECT 1 FROM practice_log l WHERE l.plan_id = practice_plan.id);
      DELETE FROM shot WHERE source = 'sample';
      DELETE FROM session WHERE source = 'sample'
        AND NOT EXISTS (SELECT 1 FROM shot WHERE shot.session_id = session.id);
      DELETE FROM round WHERE source = 'sample'
        AND NOT EXISTS (SELECT 1 FROM session s WHERE s.round_id = round.id AND s.source <> 'sample');
      DELETE FROM bag WHERE source = 'sample';
      DELETE FROM club WHERE source = 'sample'
        AND NOT EXISTS (SELECT 1 FROM shot WHERE shot.club_id = club.id);
      DELETE FROM course WHERE source = 'sample'
        AND NOT EXISTS (SELECT 1 FROM round WHERE round.course_id = course.id);
    `);
  })();
  const kept = countBySource(db, 'sample');
  const removed = Object.fromEntries(
    (Object.keys(before) as (keyof SampleCounts)[]).map((k) => [k, before[k] - kept[k]]),
  ) as unknown as SampleCounts;
  return { removed, kept };
}
