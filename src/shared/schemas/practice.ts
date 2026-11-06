import { z } from 'zod';
import { Id, IsoDate, IsoTimestamp, Source, optionalText, shortText } from './common';

export const DrillCategory = z.enum(['driving', 'approach', 'short_game', 'putting', 'full_swing']);
export type DrillCategory = z.infer<typeof DrillCategory>;

export const Drill = z.object({
  id: Id,
  name: shortText(80),
  category: DrillCategory,
  description: z.string().max(2000),
  resultLabel: optionalText(60),
  higherIsBetter: z.boolean(),
  builtin: z.boolean(),
});
export type Drill = z.infer<typeof Drill>;

export const PracticePlan = z.object({
  id: Id,
  name: shortText(80),
  focus: optionalText(200),
  scheduledFor: IsoDate.nullable(),
  status: z.enum(['planned', 'done', 'skipped']),
  items: z.array(z.object({ drillId: Id, minutes: z.number().int().min(1).max(240) })),
  source: Source,
  createdAt: IsoTimestamp,
});
export type PracticePlan = z.infer<typeof PracticePlan>;

export const PracticeLog = z.object({
  id: Id,
  drillId: Id,
  planId: Id.nullable(),
  performedOn: IsoDate,
  minutes: z.number().int().min(1).max(480),
  result: z.number().finite().nullable(),
  notes: optionalText(2000),
  source: Source,
  createdAt: IsoTimestamp,
});
export type PracticeLog = z.infer<typeof PracticeLog>;
