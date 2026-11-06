import { z } from 'zod';
import {
  Club,
  ClubInput,
  ClubModelInfo,
  CourseDetail,
  DrillCategory,
  FairwayResult,
  HoleGeometry,
  Id,
  IsoDate,
  IsoTimestamp,
  Lie,
  SessionKind,
  Source,
  measured,
  optionalText,
  shortText,
} from './schemas';

/*
 * Shapes exchanged over IPC that aren't raw entities: summaries, statistics,
 * and action inputs. Every derived number carries its sample size so screens
 * can show it and suppress anything below MIN_SAMPLE_FOR_AVERAGE.
 */

const n = z.number().int().nonnegative();
const num = z.number().nullable();

// ─── Clubs & bag ────────────────────────────────────────────────────────────

export const ClubStats = z.object({
  n, // non-excluded shots with a carry
  excluded: n,
  carryMean: num,
  carrySd: num,
  carryP10: num,
  carryP90: num,
  totalMean: num,
  offlineMean: num,
  offlineSd: num,
  ballSpeedMean: num,
  clubSpeedMean: num,
  smashMean: num,
  launchMean: num,
  spinMean: num,
  apexMean: num,
  descentMean: num,
  /** Each metric's own sample size (devices don't all capture every field). */
  counts: z.record(z.string(), n),
});
export type ClubStats = z.infer<typeof ClubStats>;

export const ClubSummary = Club.extend({
  inBag: z.boolean(),
  slot: z.number().int().nullable(),
  stats: ClubStats,
});
export type ClubSummary = z.infer<typeof ClubSummary>;

/** `modelInfo` left out keeps whatever the club already has; null clears it. */
export const ClubSave = z.object({ id: Id.nullable(), club: ClubInput, modelInfo: ClubModelInfo.nullable().optional() });
export const BagSetClubs = z.object({ clubIds: z.array(Id).max(14) });

// ─── Shots & sessions ───────────────────────────────────────────────────────

export const ShotPoint = z.object({
  id: Id,
  sessionId: Id,
  startedAt: IsoTimestamp,
  carryM: num,
  totalM: num,
  offlineM: num,
  ballSpeedMps: num,
  launchDeg: num,
  spinRpm: num,
  excluded: z.boolean(),
  source: Source,
});
export type ShotPoint = z.infer<typeof ShotPoint>;

export const SessionSummary = z.object({
  id: Id,
  kind: SessionKind,
  startedAt: IsoTimestamp,
  location: z.string().nullable(),
  device: z.string().nullable(),
  source: Source,
  shotCount: n,
  clubs: z.array(z.string()),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

// ─── Rounds ─────────────────────────────────────────────────────────────────

export const RoundSummary = z.object({
  id: Id,
  playedOn: IsoDate,
  courseId: Id,
  courseName: z.string(),
  teeName: z.string().nullable(),
  holesPlanned: z.number().int(),
  holesPlayed: n,
  strokes: n,
  par: n,
  putts: num,
  puttsHoles: n,
  gir: n,
  girHoles: n,
  fairways: n,
  fairwayHoles: n,
  penalties: n,
  hasShots: z.boolean(),
  source: Source,
});
export type RoundSummary = z.infer<typeof RoundSummary>;

export const ScoreEntry = z
  .object({
    holeId: Id,
    strokes: z.number().int().min(1).max(20),
    putts: z.number().int().min(0).max(10).nullable(),
    fairway: FairwayResult.nullable(),
    penalties: z.number().int().min(0).max(10),
    sandShots: z.number().int().min(0).max(10),
    firstPuttM: measured(0, 60),
  })
  .refine((s) => s.putts === null || s.putts <= s.strokes, { message: 'More putts than strokes', path: ['putts'] })
  .refine((s) => s.penalties + (s.putts ?? 0) <= s.strokes, {
    message: 'Putts plus penalties exceed strokes',
    path: ['penalties'],
  });
export type ScoreEntry = z.infer<typeof ScoreEntry>;

export const RoundHole = z.object({
  holeId: Id,
  number: z.number().int(),
  par: z.number().int(),
  strokeIndex: z.number().int().nullable(),
  lengthM: num,
  score: z
    .object({
      strokes: z.number().int(),
      putts: z.number().int().nullable(),
      fairway: FairwayResult.nullable(),
      penalties: z.number().int(),
      sandShots: z.number().int(),
      firstPuttM: num,
    })
    .nullable(),
});
export type RoundHole = z.infer<typeof RoundHole>;

export const RoundDetail = RoundSummary.extend({
  conditions: z.string().nullable(),
  notes: z.string().nullable(),
  holes: z.array(RoundHole),
});
export type RoundDetail = z.infer<typeof RoundDetail>;

export const RoundCreate = z.object({
  courseId: Id,
  teeId: Id.nullable(),
  playedOn: IsoDate,
  holesPlanned: z.union([z.literal(9), z.literal(18)]),
  startHole: z.union([z.literal(1), z.literal(10)]),
  conditions: optionalText(200),
  notes: optionalText(2000),
  scores: z.array(ScoreEntry).min(1).max(18),
});
export type RoundCreate = z.infer<typeof RoundCreate>;

// ─── Courses ────────────────────────────────────────────────────────────────

export const CourseSummary = z.object({
  id: Id,
  name: z.string(),
  location: z.string().nullable(),
  source: Source,
  attribution: z.string().nullable(),
  holes: n,
  par: n,
  rounds: n,
  tees: z.array(z.object({ id: Id, name: z.string(), courseRating: num, slopeRating: num, lengthM: num })),
});
export type CourseSummary = z.infer<typeof CourseSummary>;

export { CourseDetail };

export const CourseCreate = z
  .object({
    name: shortText(100),
    location: optionalText(120),
    tee: z.object({
      name: shortText(40),
      courseRating: z.number().min(50).max(85).nullable(),
      slopeRating: z.number().int().min(55).max(155).nullable(),
    }),
    holes: z
      .array(
        z.object({
          number: z.number().int().min(1).max(18),
          par: z.number().int().min(3).max(6),
          strokeIndex: z.number().int().min(1).max(18).nullable(),
          lengthM: z.number().min(50).max(750).nullable(),
        }),
      )
      .refine((h) => h.length === 9 || h.length === 18, 'A course has 9 or 18 holes'),
  })
  .refine((c) => new Set(c.holes.map((h) => h.number)).size === c.holes.length, { message: 'Hole numbers must be unique', path: ['holes'] })
  .refine(
    (c) => {
      const si = c.holes.map((h) => h.strokeIndex).filter((s): s is number => s !== null);
      return new Set(si).size === si.length;
    },
    { message: 'Each stroke index can only be used once', path: ['holes'] },
  );
export type CourseCreate = z.infer<typeof CourseCreate>;

// ─── Real-course search (OpenStreetMap) ─────────────────────────────────────

export const OsmRef = z.object({ type: z.enum(['node', 'way', 'relation']), id: z.number().int().positive() });
export type OsmRef = z.infer<typeof OsmRef>;

export const CourseSearchResult = z.object({
  osm: OsmRef,
  name: z.string(),
  place: z.string(),
  /** [south, west, north, east] */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  alreadyImported: z.boolean(),
});
export type CourseSearchResult = z.infer<typeof CourseSearchResult>;

export const PreviewHole = z.object({
  key: z.string(),
  number: z.number().int().min(1).max(18).nullable(),
  par: z.number().int().min(3).max(6).nullable(),
  strokeIndex: z.number().int().min(1).max(18).nullable(),
  /** Measured along the mapped line of play; not a scorecard yardage. */
  lengthM: z.number().nullable(),
  geometry: HoleGeometry,
  has: z.object({ green: z.boolean(), tee: z.boolean(), fairway: z.boolean(), bunkers: n, water: n }),
});
export type PreviewHole = z.infer<typeof PreviewHole>;

export const CoursePreview = z.object({
  osm: OsmRef,
  name: z.string(),
  place: z.string(),
  holes: z.array(PreviewHole),
  /** Course-wide top-down drawing in metres (east = +x, north = +y). */
  overview: z.object({
    holes: z.array(z.object({ key: z.string(), line: z.array(z.tuple([z.number(), z.number()])) })),
    greens: z.array(z.array(z.tuple([z.number(), z.number()]))),
    bunkers: z.array(z.array(z.tuple([z.number(), z.number()]))),
    water: z.array(z.array(z.tuple([z.number(), z.number()]))),
    fairways: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
  notes: z.array(z.string()),
  attribution: z.string(),
  /** Aerial photo of the whole course (north up) covering `bounds` in overview metres. */
  photo: z.object({ dataUrl: z.string().max(3_000_000), bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]) }).nullable(),
  /** Outcome of checking the map against the aerial photo. */
  photoCheck: z.object({
    available: z.boolean(),
    /** Shift applied to the map to line it up with the photo, metres east/north; null when none was needed. */
    shiftM: z.tuple([z.number(), z.number()]).nullable(),
    summary: z.string(),
  }),
  terrain: z.object({ available: z.boolean(), reliefM: z.number().nullable() }),
  credits: z.array(z.string()),
});
export type CoursePreview = z.infer<typeof CoursePreview>;

export const CourseImport = z
  .object({
    osm: OsmRef,
    name: shortText(100),
    location: optionalText(120),
    tee: z.object({
      name: shortText(40),
      courseRating: z.number().min(50).max(85).nullable(),
      slopeRating: z.number().int().min(55).max(155).nullable(),
    }),
    holes: z
      .array(
        z.object({
          /** Preview hole key, so the main process can attach the hole's aerial photo. */
          key: z.string().max(40).optional(),
          number: z.number().int().min(1).max(18),
          par: z.number().int().min(3).max(6),
          strokeIndex: z.number().int().min(1).max(18).nullable(),
          lengthM: z.number().min(50).max(750).nullable(),
          geometry: HoleGeometry,
        }),
      )
      .refine((h) => h.length === 9 || h.length === 18, 'Pick 9 or 18 holes'),
  })
  .refine((c) => new Set(c.holes.map((h) => h.number)).size === c.holes.length, { message: 'Each hole number can only be used once', path: ['holes'] })
  .refine((c) => c.holes.every((h) => h.number <= c.holes.length), { message: 'Hole numbers must run from 1 to the number of holes', path: ['holes'] })
  .refine(
    (c) => {
      const si = c.holes.map((h) => h.strokeIndex).filter((s): s is number => s !== null);
      return new Set(si).size === si.length;
    },
    { message: 'Each stroke index can only be used once', path: ['holes'] },
  );
export type CourseImport = z.infer<typeof CourseImport>;

export const HoleImagery = z.object({
  dataUrl: z.string(),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  attribution: z.string(),
});
export type HoleImagery = z.infer<typeof HoleImagery>;

export const HoleTrack = z.object({
  roundId: Id,
  playedOn: IsoDate,
  strokes: z.number().int(),
  par: z.number().int(),
  shots: z.array(
    z.object({
      seq: z.number().int(),
      club: z.string(),
      lie: Lie.nullable(),
      start: z.tuple([z.number(), z.number()]),
      end: z.tuple([z.number(), z.number()]),
      distanceM: z.number(),
    }),
  ),
});
export type HoleTrack = z.infer<typeof HoleTrack>;

export const HoleRecord = z.object({
  holeId: Id,
  played: n,
  avgStrokes: num,
  bestStrokes: num,
  tracks: z.array(HoleTrack),
});
export type HoleRecord = z.infer<typeof HoleRecord>;

// ─── Performance ────────────────────────────────────────────────────────────

export const ScoreMix = z.object({
  eagle: n,
  birdie: n,
  par: n,
  bogey: n,
  double: n,
  triple: n,
});
export type ScoreMix = z.infer<typeof ScoreMix>;

export const Performance = z.object({
  rounds: z.array(
    RoundSummary.extend({ mix: ScoreMix, scrambles: n, scrambleChances: n, threePutts: n }),
  ),
  byPar: z.array(z.object({ par: z.number().int(), holes: n, avgToPar: num })),
  puttMakeByDistance: z.array(
    z.object({ label: z.string(), minM: z.number(), maxM: z.number(), attempts: n, oneputts: n }),
  ),
  byHole: z.array(z.object({ number: z.number().int(), par: z.number().int(), played: n, avgToPar: num })),
  courseName: z.string().nullable(),
});
export type Performance = z.infer<typeof Performance>;

// ─── Practice ───────────────────────────────────────────────────────────────

export const DrillSummary = z.object({
  id: Id,
  name: z.string(),
  category: DrillCategory,
  description: z.string(),
  resultLabel: z.string().nullable(),
  higherIsBetter: z.boolean(),
  builtin: z.boolean(),
  history: z.array(z.object({ performedOn: IsoDate, result: num, minutes: n, source: Source })),
});
export type DrillSummary = z.infer<typeof DrillSummary>;

export const PlanSummary = z.object({
  id: Id,
  name: z.string(),
  focus: z.string().nullable(),
  scheduledFor: IsoDate.nullable(),
  status: z.enum(['planned', 'done', 'skipped']),
  source: Source,
  items: z.array(z.object({ drillId: Id, drillName: z.string(), minutes: n })),
});
export type PlanSummary = z.infer<typeof PlanSummary>;

export const PracticeOverview = z.object({
  drills: z.array(DrillSummary),
  plans: z.array(PlanSummary),
  minutesByCategory: z.array(z.object({ category: DrillCategory, minutes: n })),
  logsLast30: n,
  minutesLast30: n,
});
export type PracticeOverview = z.infer<typeof PracticeOverview>;

export const PracticeLogInput = z.object({
  drillId: Id,
  planId: Id.nullable(),
  performedOn: IsoDate,
  minutes: z.number().int().min(1).max(480),
  result: z.number().finite().min(0).max(1000).nullable(),
  notes: optionalText(2000),
});
export type PracticeLogInput = z.infer<typeof PracticeLogInput>;

export const PlanCreate = z.object({
  name: shortText(80),
  focus: optionalText(200),
  scheduledFor: IsoDate.nullable(),
  items: z.array(z.object({ drillId: Id, minutes: z.number().int().min(1).max(240) })).min(1).max(12),
});
export type PlanCreate = z.infer<typeof PlanCreate>;

// ─── Intelligence ───────────────────────────────────────────────────────────

export const InsightArea = z.enum(['driving', 'approach', 'short_game', 'putting', 'scoring', 'equipment', 'practice', 'data']);
export type InsightArea = z.infer<typeof InsightArea>;

export const Insight = z.object({
  key: z.string(),
  kind: z.enum(['strength', 'opportunity', 'note']),
  area: InsightArea,
  title: z.string(),
  detail: z.string(),
  evidence: z.array(z.object({ label: z.string(), value: z.string(), n: n.nullable() })),
  /** How the rule decided, in plain words. */
  rule: z.string(),
  suggestedDrill: z.string().nullable(),
  dismissed: z.boolean(),
  usesSample: z.boolean(),
});
export type Insight = z.infer<typeof Insight>;

// ─── Dashboard ──────────────────────────────────────────────────────────────

const Kpi = z.object({ value: num, n, priorValue: num, priorN: n });
export type Kpi = z.infer<typeof Kpi>;

export const DashboardOverview = z.object({
  scoring: Kpi, // strokes per full 18-hole round: last 5 vs the 5 before
  girPct: Kpi,
  fairwayPct: Kpi,
  puttsPerRound: Kpi,
  recentRounds: z.array(RoundSummary),
  ladder: z.array(z.object({ clubId: Id, label: z.string(), kind: z.string(), carryMean: num, carrySd: num, n })),
  practice: z.object({ minutesLast30: n, logsLast30: n, nextPlan: PlanSummary.nullable() }),
  insights: z.array(Insight),
});
export type DashboardOverview = z.infer<typeof DashboardOverview>;
