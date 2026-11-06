import { z } from 'zod';
import { ClubModelInfo } from './ai';
import { Id, IsoDate, IsoTimestamp, Source, measured, optionalText, shortText } from './common';

export const CLUB_KINDS = ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'] as const;
export const ClubKind = z.enum(CLUB_KINDS);
export type ClubKind = z.infer<typeof ClubKind>;

export const ShaftFlex = z.enum(['L', 'A', 'R', 'S', 'X', 'TX']);

const clubFields = {
  kind: ClubKind,
  label: shortText(40),
  make: optionalText(60),
  model: optionalText(80),
  loftDeg: measured(0, 70),
  lieDeg: measured(40, 80),
  lengthM: measured(0.6, 1.25),
  shaftMake: optionalText(60),
  shaftModel: optionalText(80),
  shaftFlex: ShaftFlex.nullable(),
  shaftWeightG: measured(30, 150),
  swingWeight: z
    .string()
    .regex(/^[A-G]\d(\.\d)?$/, 'Use a swing weight like D2 or C9.5')
    .nullable(),
  grip: optionalText(80),
  acquiredOn: IsoDate.nullable(),
  retiredOn: IsoDate.nullable(),
  notes: optionalText(2000),
};

const retiredAfterAcquired = (c: { acquiredOn: string | null; retiredOn: string | null }) =>
  c.acquiredOn === null || c.retiredOn === null || c.retiredOn >= c.acquiredOn;

export const Club = z.object({
  id: Id,
  ...clubFields,
  /** What ChatGPT found about this club model; advisory, never a measurement. */
  modelInfo: ClubModelInfo.nullable(),
  source: Source,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Club = z.infer<typeof Club>;

export const ClubInput = z
  .object(clubFields)
  .refine(retiredAfterAcquired, { message: 'Retired date must be after acquired date', path: ['retiredOn'] });
export type ClubInput = z.infer<typeof ClubInput>;

export const Bag = z.object({
  id: Id,
  name: shortText(60),
  isActive: z.boolean(),
  source: Source,
  createdAt: IsoTimestamp,
  /** Club ids in slot order. */
  clubIds: z.array(Id).max(14),
});
export type Bag = z.infer<typeof Bag>;

export const BagInput = z.object({
  name: shortText(60),
  clubIds: z
    .array(Id)
    .max(14, 'A bag can hold at most 14 clubs')
    .refine((ids) => new Set(ids).size === ids.length, 'A club can only be in a bag once'),
});
export type BagInput = z.infer<typeof BagInput>;
