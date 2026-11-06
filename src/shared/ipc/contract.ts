import { z } from 'zod';

/**
 * The single IPC contract between renderer and main.
 *
 * Each channel declares the Zod schema for its input and output. Main validates
 * input against `input` before any work; renderer call sites are typed from
 * `z.infer` of both. Adding a channel here is the only way to expose new
 * capability to the renderer.
 *
 * Domain channels (bag, shots, rounds, …) are added module by module.
 */

const Empty = z.object({}).strict();

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

export const contract = {
  'app.info': { input: Empty, output: AppInfo },
  'db.health': { input: Empty, output: DbHealth },
  'data.summary': { input: Empty, output: DataSummary },
  'data.loadSample': { input: Empty, output: DataSummary },
  'data.clearSample': { input: Empty, output: z.object({ removed: Counts, kept: Counts, summary: DataSummary }) },
} as const satisfies Record<string, { input: z.ZodType; output: z.ZodType }>;

export type Contract = typeof contract;
export type Channel = keyof Contract;
export type ChannelInput<C extends Channel> = z.input<Contract[C]['input']>;
export type ChannelOutput<C extends Channel> = z.output<Contract[C]['output']>;

export const CHANNELS = Object.keys(contract) as Channel[];

export const isChannel = (value: unknown): value is Channel =>
  typeof value === 'string' && Object.hasOwn(contract, value);
