import { z } from 'zod';
import { Id, IsoDate, IsoTimestamp, Source, measured, optionalText } from './common';

export const FairwayResult = z.enum(['hit', 'left', 'right', 'short', 'long']);
export type FairwayResult = z.infer<typeof FairwayResult>;

export const HoleScore = z
  .object({
    id: Id,
    holeId: Id,
    strokes: z.number().int().min(1).max(20),
    putts: z.number().int().min(0).max(10).nullable(),
    fairway: FairwayResult.nullable(),
    penalties: z.number().int().min(0).max(10),
    sandShots: z.number().int().min(0).max(10),
    firstPuttM: measured(0, 60),
  })
  .refine((s) => s.putts === null || s.putts <= s.strokes, {
    message: 'Putts cannot exceed strokes',
    path: ['putts'],
  })
  .refine((s) => s.penalties + (s.putts ?? 0) <= s.strokes, {
    message: 'Putts plus penalties cannot exceed strokes',
    path: ['penalties'],
  });
export type HoleScore = z.infer<typeof HoleScore>;

export const Round = z.object({
  id: Id,
  courseId: Id,
  teeId: Id.nullable(),
  playedOn: IsoDate,
  holesPlanned: z.union([z.literal(9), z.literal(18)]),
  startHole: z.union([z.literal(1), z.literal(10)]),
  conditions: optionalText(200),
  notes: optionalText(2000),
  completedAt: IsoTimestamp.nullable(),
  source: Source,
  createdAt: IsoTimestamp,
});
export type Round = z.infer<typeof Round>;
