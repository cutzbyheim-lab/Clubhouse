import { m0001 } from './0001_initial_schema';
import type { Migration } from './types';

/**
 * Ordered list of every migration. Append only: never edit or reorder a
 * migration that has shipped.
 */
export const migrations: readonly Migration[] = [m0001];
