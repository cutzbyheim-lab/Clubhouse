import { m0001 } from './0001_initial_schema';
import { m0002 } from './0002_course_source';
import { m0003 } from './0003_hole_imagery';
import type { Migration } from './types';

/**
 * Ordered list of every migration. Append only: never edit or reorder a
 * migration that has shipped.
 */
export const migrations: readonly Migration[] = [m0001, m0002, m0003];
