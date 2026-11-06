import { z } from 'zod';
import { Id, IsoTimestamp, Source, measured, optionalText } from './common';

export const SessionKind = z.enum(['range', 'simulator', 'course', 'practice']);
export const Lie = z.enum(['tee', 'fairway', 'rough', 'sand', 'recovery', 'fringe', 'green', 'mat']);

/**
 * Physical limits for each launch metric, in canonical units.
 * Must match the CHECK ranges in migration 0001 (asserted in tests).
 */
export const SHOT_METRIC_LIMITS = {
  carryM: [0, 400],
  totalM: [0, 450],
  offlineM: [-150, 150],
  ballSpeedMps: [0, 95],
  clubSpeedMps: [0, 65],
  launchDeg: [-10, 70],
  launchDirDeg: [-45, 45],
  spinRpm: [0, 15000],
  spinAxisDeg: [-90, 90],
  apexM: [0, 80],
  descentDeg: [0, 90],
  attackDeg: [-15, 15],
  clubPathDeg: [-20, 20],
  faceAngleDeg: [-20, 20],
} as const satisfies Record<string, readonly [number, number]>;

export type ShotMetric = keyof typeof SHOT_METRIC_LIMITS;

const metricShape = Object.fromEntries(
  Object.entries(SHOT_METRIC_LIMITS).map(([k, [min, max]]) => [k, measured(min, max)]),
) as { [K in ShotMetric]: ReturnType<typeof measured> };

export const ShotMetrics = z
  .object(metricShape)
  .refine((m) => m.totalM === null || m.carryM === null || m.totalM >= m.carryM, {
    message: 'Total distance cannot be shorter than carry',
    path: ['totalM'],
  });
export type ShotMetrics = z.infer<typeof ShotMetrics>;

export const Shot = z.object({
  id: Id,
  sessionId: Id,
  clubId: Id,
  seq: z.number().int().min(1),
  holeScoreId: Id.nullable(),
  lie: Lie.nullable(),
  metrics: ShotMetrics,
  /** Start and end on the hole (HoleGeometry frame), for on-course shots. */
  position: z
    .object({
      start: z.tuple([z.number().min(-250).max(250), z.number().min(-100).max(800)]),
      end: z.tuple([z.number().min(-250).max(250), z.number().min(-100).max(800)]).nullable(),
    })
    .nullable(),
  excluded: z.boolean(),
  source: Source,
  createdAt: IsoTimestamp,
});
export type Shot = z.infer<typeof Shot>;

export const Session = z.object({
  id: Id,
  kind: SessionKind,
  startedAt: IsoTimestamp,
  location: optionalText(120),
  device: optionalText(80),
  roundId: Id.nullable(),
  notes: optionalText(2000),
  source: Source,
  createdAt: IsoTimestamp,
});
export type Session = z.infer<typeof Session>;
