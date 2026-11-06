export const APP_NAME = 'Clubhouse';
export const DB_FILENAME = 'clubhouse.db';

/** The single IPC channel name the preload bridges; routing happens inside. */
export const IPC_INVOKE = 'clubhouse:invoke';

/**
 * Derived statistics are hidden below this sample size so the app never
 * presents a two-shot "average" as if it meant something.
 */
export const MIN_SAMPLE_FOR_AVERAGE = 5;

/** Provenance of every measured row. See ARCHITECTURE.md §1. */
export const DATA_SOURCES = ['manual', 'imported', 'sample'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
