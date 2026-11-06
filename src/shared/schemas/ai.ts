import { z } from 'zod';
import { IsoTimestamp } from './common';

/*
 * Everything ChatGPT tells us is advisory: who made a club, what kind of
 * player it was designed for, what a bag suggests about its owner. None of it
 * is a measurement, so it lives in its own shapes, is always shown labelled as
 * coming from ChatGPT, and never feeds the measured statistics.
 */

/** Head shapes the 3D model can draw. Generic forms, not replicas of any product. */
export const HEAD_STYLES = [
  'wood-standard',
  'wood-compact',
  'wood-deep',
  'wood-shallow',
  'iron-blade',
  'iron-muscle-cavity',
  'iron-cavity',
  'iron-hollow',
  'iron-oversize',
  'wedge-blade',
  'wedge-cavity',
  'wedge-wide-sole',
  'putter-blade',
  'putter-midmallet',
  'putter-mallet',
] as const;
export const HeadStyle = z.enum(HEAD_STYLES);
export type HeadStyle = z.infer<typeof HeadStyle>;

export const HEAD_FINISHES = ['chrome', 'satin', 'black', 'gunmetal', 'raw', 'two-tone'] as const;
export const HeadFinish = z.enum(HEAD_FINISHES);
export type HeadFinish = z.infer<typeof HeadFinish>;

export const OFFSETS = ['none', 'minimal', 'moderate', 'strong'] as const;
export const WEIGHTINGS = ['neutral', 'draw', 'fade', 'low-back', 'low-forward', 'perimeter', 'unknown'] as const;

export const PLAYER_CATEGORIES = ['tour', 'players', 'players-distance', 'game-improvement', 'super-game-improvement', 'unknown'] as const;
export const PlayerCategory = z.enum(PLAYER_CATEGORIES);
export type PlayerCategory = z.infer<typeof PlayerCategory>;

export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const HeadDesign = z.object({
  style: HeadStyle,
  /** Head volume in cc for woods and hybrids, when the maker publishes it. */
  volumeCc: z.number().min(50).max(470).nullable(),
  finish: HeadFinish,
  /** Main crown/body colour as a hex value, if the model has a distinctive one. */
  crownColor: hex.nullable(),
  offset: z.enum(OFFSETS),
  weighting: z.enum(WEIGHTINGS),
  adjustableHosel: z.boolean(),
});
export type HeadDesign = z.infer<typeof HeadDesign>;

export const WebSource = z.object({ url: z.url({ protocol: /^https?$/ }).max(2000), title: z.string().max(300) });
export type WebSource = z.infer<typeof WebSource>;

/** Manufacturer spec for one loft/version of the club, as published. */
export const SpecOption = z.object({
  label: z.string().min(1).max(60),
  loftDeg: z.number().min(0).max(70).nullable(),
  lieDeg: z.number().min(40).max(80).nullable(),
  lengthIn: z.number().min(24).max(49).nullable(),
  swingWeight: z.string().regex(/^[A-G]\d(\.\d)?$/).nullable(),
});
export type SpecOption = z.infer<typeof SpecOption>;

export const StockShaft = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(80),
  flexes: z.array(z.enum(['L', 'A', 'R', 'S', 'X', 'TX'])).max(6),
  weightG: z.number().min(30).max(150).nullable(),
});
export type StockShaft = z.infer<typeof StockShaft>;

/** What a ChatGPT web lookup found for a club query. */
export const ClubLookup = z.object({
  found: z.boolean(),
  make: z.string().max(60),
  model: z.string().max(80),
  releaseYear: z.number().int().min(1950).max(2100).nullable(),
  kind: z.enum(['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter']),
  clubName: z.string().max(40),
  playerCategory: PlayerCategory,
  construction: z.string().max(300),
  head: HeadDesign,
  specOptions: z.array(SpecOption).max(12),
  stockShafts: z.array(StockShaft).max(8),
  designedFor: z.string().max(400),
  playerSignals: z.array(z.string().max(300)).max(6),
  confidence: Confidence,
  note: z.string().max(400).nullable(),
  sources: z.array(WebSource).max(10),
  aiModel: z.string().max(100),
});
export type ClubLookup = z.infer<typeof ClubLookup>;

/** The part of a lookup kept with the club once the player uses it. */
export const ClubModelInfo = ClubLookup.pick({
  make: true,
  model: true,
  releaseYear: true,
  clubName: true,
  playerCategory: true,
  construction: true,
  head: true,
  designedFor: true,
  playerSignals: true,
  confidence: true,
  sources: true,
  aiModel: true,
}).extend({
  specLabel: z.string().max(60).nullable(),
  identifiedAt: IsoTimestamp,
});
export type ClubModelInfo = z.infer<typeof ClubModelInfo>;

export const SKILL_LEVELS = ['beginner', 'high-handicap', 'mid-handicap', 'low-handicap', 'scratch-or-better', 'unclear'] as const;

export const PlayerAnalysisBody = z.object({
  headline: z.string().max(300),
  skill: z.object({ level: z.enum(SKILL_LEVELS), handicapRange: z.string().max(40), reasoning: z.string().max(800) }),
  swingSpeed: z.object({
    /** Driver swing speed as a range, in the player's speed unit, e.g. "95–102 mph". */
    driverSpeed: z.string().max(40),
    basis: z.enum(['measured', 'equipment', 'unclear']),
    reasoning: z.string().max(800),
  }),
  ballFlight: z.object({ tendency: z.string().max(120), reasoning: z.string().max(800) }),
  traits: z.array(z.object({ title: z.string().max(100), detail: z.string().max(600), clubs: z.array(z.string().max(40)).max(14) })).max(6),
  suggestions: z.array(z.object({ title: z.string().max(100), detail: z.string().max(600) })).max(5),
  caveats: z.string().max(600),
});
export type PlayerAnalysisBody = z.infer<typeof PlayerAnalysisBody>;

export const PlayerAnalysis = z.object({
  id: z.number().int().positive(),
  body: PlayerAnalysisBody,
  aiModel: z.string(),
  clubCount: z.number().int(),
  createdAt: IsoTimestamp,
  /** The bag has changed since this was written. */
  stale: z.boolean(),
});
export type PlayerAnalysis = z.infer<typeof PlayerAnalysis>;

export const AiStatus = z.object({
  connected: z.boolean(),
  /** Last four characters of the key, for recognition only. */
  keyHint: z.string().nullable(),
  model: z.string().nullable(),
  models: z.array(z.string()),
  /** False when this computer can't encrypt the key; connecting is refused. */
  secureStorage: z.boolean(),
});
export type AiStatus = z.infer<typeof AiStatus>;
