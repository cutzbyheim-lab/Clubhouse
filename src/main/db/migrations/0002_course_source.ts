import type { Migration } from './types';

/**
 * Courses imported from an outside source remember where they came from
 * (e.g. "osm:way/123456") and the credit that source requires.
 */
export const m0002: Migration = {
  id: 2,
  name: 'course_source',
  up: (db) =>
    db.exec(`
      ALTER TABLE course ADD COLUMN external_ref TEXT
        CHECK (external_ref IS NULL OR external_ref GLOB 'osm:[nwr]*/[0-9]*');
      ALTER TABLE course ADD COLUMN attribution TEXT
        CHECK (attribution IS NULL OR length(attribution) <= 200);
      CREATE UNIQUE INDEX course_external_ref ON course (external_ref) WHERE external_ref IS NOT NULL;
    `),
};
