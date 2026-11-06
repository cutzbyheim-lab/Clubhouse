import { z } from 'zod';
import {
  BagSetClubs,
  ClubSave,
  ClubSummary,
  CourseCreate,
  CourseImport,
  CoursePreview,
  CourseSearchResult,
  CourseDetail,
  CourseSummary,
  DashboardOverview,
  HoleImagery,
  HoleRecord,
  Insight,
  Performance,
  PlanCreate,
  PracticeLogInput,
  PracticeOverview,
  RoundCreate,
  RoundDetail,
  RoundSummary,
  SessionSummary,
  ShotPoint,
} from '../dto';
import { AiStatus, CLUB_KINDS, ClubLookup, Id, PlayerAnalysis, PlayerProfile, PlayerProfileUpdate } from '../schemas';

/**
 * The single IPC contract between renderer and main.
 *
 * Each channel declares the Zod schema for its input and output. Main validates
 * input against `input` before any work; renderer call sites are typed from
 * `z.infer` of both. Adding a channel here is the only way to expose new
 * capability to the renderer.
 */

const Empty = z.object({}).strict();
const ById = z.object({ id: Id }).strict();
const Ok = z.object({ ok: z.literal(true) });

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
});

export const DbHealth = z.object({
  path: z.string(),
  sqliteVersion: z.string(),
  journalMode: z.string(),
  foreignKeys: z.boolean(),
  schemaVersion: z.number().int().nonnegative(),
  appliedMigrations: z.array(z.object({ id: z.number().int(), name: z.string(), appliedAt: z.string() })),
});

const Counts = z.object({
  clubs: z.number().int(),
  bags: z.number().int(),
  courses: z.number().int(),
  rounds: z.number().int(),
  sessions: z.number().int(),
  shots: z.number().int(),
  practicePlans: z.number().int(),
  practiceLogs: z.number().int(),
});
export type Counts = z.infer<typeof Counts>;

export const DataSummary = z.object({ own: Counts, sample: Counts, hasSample: z.boolean(), hasOwn: z.boolean() });
export type DataSummary = z.infer<typeof DataSummary>;

export const UpdateStatus = z.object({
  state: z.enum(['disabled', 'idle', 'checking', 'current', 'downloading', 'ready', 'error']),
  currentVersion: z.string(),
  availableVersion: z.string().optional(),
  percent: z.number().optional(),
  message: z.string().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;

export const contract = {
  'app.info': { input: Empty, output: AppInfo },
  'app.updateStatus': { input: Empty, output: UpdateStatus },
  'app.checkForUpdates': { input: Empty, output: UpdateStatus },
  'app.installUpdate': { input: Empty, output: Ok },
  'db.health': { input: Empty, output: DbHealth },

  'data.summary': { input: Empty, output: DataSummary },
  'data.loadSample': { input: Empty, output: DataSummary },
  'data.clearSample': { input: Empty, output: z.object({ removed: Counts, kept: Counts, summary: DataSummary }) },

  'profile.get': { input: Empty, output: PlayerProfile },
  'profile.update': { input: PlayerProfileUpdate.strict(), output: PlayerProfile },

  'dashboard.overview': { input: Empty, output: DashboardOverview },

  'clubs.list': { input: Empty, output: z.array(ClubSummary) },
  'clubs.save': { input: ClubSave, output: ClubSummary },
  'clubs.delete': { input: ById, output: Ok },
  'bag.setClubs': { input: BagSetClubs, output: z.array(ClubSummary) },

  'shots.forClub': { input: z.object({ clubId: Id }).strict(), output: z.array(ShotPoint) },
  'shots.setExcluded': { input: z.object({ id: Id, excluded: z.boolean() }).strict(), output: Ok },
  'sessions.list': { input: Empty, output: z.array(SessionSummary) },

  'rounds.list': { input: Empty, output: z.array(RoundSummary) },
  'rounds.get': { input: ById, output: RoundDetail },
  'rounds.create': { input: RoundCreate, output: RoundDetail },
  'rounds.delete': { input: ById, output: Ok },

  'courses.list': { input: Empty, output: z.array(CourseSummary) },
  'courses.get': { input: ById, output: CourseDetail },
  'courses.create': { input: CourseCreate, output: CourseSummary },
  'courses.search': { input: z.object({ query: z.string().trim().min(2).max(100) }).strict(), output: z.array(CourseSearchResult) },
  'courses.preview': { input: CourseSearchResult.omit({ alreadyImported: true }), output: CoursePreview },
  'courses.import': { input: CourseImport, output: CourseSummary },
  'courses.detectTrees': { input: z.object({ courseId: Id }).strict(), output: z.object({ holes: z.number().int(), trees: z.number().int() }) },
  'courses.holeImagery': { input: z.object({ holeId: Id }).strict(), output: HoleImagery.nullable() },
  'courses.holeRecord': { input: z.object({ holeId: Id }).strict(), output: HoleRecord },

  'ai.status': { input: Empty, output: AiStatus },
  'ai.connect': { input: z.object({ apiKey: z.string().trim().min(1).max(400) }).strict(), output: AiStatus },
  'ai.disconnect': { input: Empty, output: AiStatus },
  'ai.setModel': { input: z.object({ model: z.string().min(1).max(100) }).strict(), output: AiStatus },
  'ai.lookupClub': {
    input: z
      .object({
        query: z.string().trim().min(2, 'Type a club, e.g. “TaylorMade Qi10 driver”').max(120),
        kind: z.enum(CLUB_KINDS).nullable(),
        label: z.string().trim().max(40).nullable(),
      })
      .strict(),
    output: ClubLookup,
  },
  'ai.analysis': { input: Empty, output: PlayerAnalysis.nullable() },
  'ai.analyzeBag': { input: Empty, output: PlayerAnalysis },

  'performance.get': { input: Empty, output: Performance },

  'practice.overview': { input: Empty, output: PracticeOverview },
  'practice.log': { input: PracticeLogInput, output: Ok },
  'practice.createPlan': { input: PlanCreate, output: Ok },
  'practice.setPlanStatus': {
    input: z.object({ id: Id, status: z.enum(['planned', 'done', 'skipped']) }).strict(),
    output: Ok,
  },

  'insights.list': { input: Empty, output: z.array(Insight) },
  'insights.setDismissed': { input: z.object({ key: z.string().min(1).max(200), dismissed: z.boolean() }).strict(), output: Ok },
} as const satisfies Record<string, { input: z.ZodType; output: z.ZodType }>;

export type Contract = typeof contract;
export type Channel = keyof Contract;
export type ChannelInput<C extends Channel> = z.input<Contract[C]['input']>;
export type ChannelOutput<C extends Channel> = z.output<Contract[C]['output']>;

export const CHANNELS = Object.keys(contract) as Channel[];

export const isChannel = (value: unknown): value is Channel =>
  typeof value === 'string' && Object.hasOwn(contract, value);
