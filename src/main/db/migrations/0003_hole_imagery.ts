import type { Migration } from './types';

/**
 * Aerial photo for each imported hole, already rotated into the hole's frame
 * so the 3D view can drape it straight onto the terrain.
 */
export const m0003: Migration = {
  id: 3,
  name: 'hole_imagery',
  up: (db) =>
    db.exec(`
      CREATE TABLE hole_imagery (
        hole_id     INTEGER PRIMARY KEY REFERENCES hole(id) ON DELETE CASCADE,
        mime        TEXT    NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
        width       INTEGER NOT NULL CHECK (width BETWEEN 16 AND 4096),
        height      INTEGER NOT NULL CHECK (height BETWEEN 16 AND 4096),
        x0          REAL    NOT NULL,
        y0          REAL    NOT NULL,
        x1          REAL    NOT NULL,
        y1          REAL    NOT NULL,
        data        BLOB    NOT NULL CHECK (length(data) <= 4000000),
        attribution TEXT    NOT NULL CHECK (length(attribution) <= 200),
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (x1 > x0 AND y1 > y0)
      ) STRICT;
    `),
};
