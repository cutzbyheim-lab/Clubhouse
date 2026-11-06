import type { Migration } from './types';

/**
 * Ordered list of every migration. Append only — never edit or reorder a
 * migration that has shipped. The domain schema arrives as 0001 in the next
 * phase.
 */
export const migrations: readonly Migration[] = [];
