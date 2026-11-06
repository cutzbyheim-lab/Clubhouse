import type { Migration } from './types';

/**
 * Real-club identity and ChatGPT player analysis.
 *
 * - club.model_info: what a ChatGPT web lookup said about the club model
 *   (manufacturer, category, head design, sources). Advisory text, never a
 *   measurement; NULL for clubs entered by hand.
 * - app_setting: small key/value settings (which OpenAI model to use). The API
 *   key itself is never stored here; it lives encrypted in its own file.
 * - player_analysis: each ChatGPT read of the bag, with the fingerprint of the
 *   bag it was made from so the app can tell when it's out of date.
 */
export const m0004: Migration = {
  id: 4,
  name: 'club_identity_ai',
  up: (db) =>
    db.exec(`
      ALTER TABLE club ADD COLUMN model_info TEXT
        CHECK (model_info IS NULL OR (json_valid(model_info) AND length(model_info) <= 20000));

      CREATE TABLE app_setting (
        key   TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 100),
        value TEXT NOT NULL CHECK (length(value) <= 2000)
      ) STRICT;

      CREATE TABLE player_analysis (
        id          INTEGER PRIMARY KEY,
        fingerprint TEXT    NOT NULL CHECK (length(fingerprint) = 64),
        ai_model    TEXT    NOT NULL CHECK (length(ai_model) BETWEEN 1 AND 100),
        club_count  INTEGER NOT NULL CHECK (club_count BETWEEN 1 AND 14),
        body        TEXT    NOT NULL CHECK (json_valid(body) AND length(body) <= 40000),
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
    `),
};
