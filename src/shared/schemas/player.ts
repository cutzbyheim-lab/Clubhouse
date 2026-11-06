import { z } from 'zod';
import { IsoTimestamp } from './common';

export const DistanceUnit = z.enum(['yards', 'metres']);
export const SpeedUnit = z.enum(['mph', 'kmh', 'mps']);
export type DistanceUnit = z.infer<typeof DistanceUnit>;
export type SpeedUnit = z.infer<typeof SpeedUnit>;

export const PlayerProfile = z.object({
  displayName: z.string().trim().min(1).max(80).nullable(),
  handedness: z.enum(['right', 'left']),
  /** As the player states it (from their club/association). Never computed by the app. */
  handicapIndex: z.number().min(-10).max(54).nullable(),
  distanceUnit: DistanceUnit,
  speedUnit: SpeedUnit,
  updatedAt: IsoTimestamp,
});
export type PlayerProfile = z.infer<typeof PlayerProfile>;

export const PlayerProfileUpdate = PlayerProfile.omit({ updatedAt: true }).partial();
export type PlayerProfileUpdate = z.infer<typeof PlayerProfileUpdate>;
