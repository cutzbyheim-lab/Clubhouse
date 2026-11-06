import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './connection';
import type { Migration } from './migrations/types';

export interface AppliedMigration {
  id: number;
  name: string;
  appliedAt: string;
}

export interface MigrationReport {
  applied: AppliedMigration[];
  schemaVersion: number;
  backupPath: string | null;
}

const BOOKKEEPING = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;
`;

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

function assertWellFormed(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    const prev = list[i - 1];
    if (!Number.isInteger(m.id) || m.id <= 0) {
      throw new MigrationError(`Migration "${m.name}" has invalid id ${m.id}`);
    }
    if (prev && m.id <= prev.id) {
      throw new MigrationError(`Migration ids must strictly increase (${prev.id} → ${m.id})`);
    }
  });
}

export function listApplied(db: DB): AppliedMigration[] {
  db.exec(BOOKKEEPING);
  return db
    .prepare<[], { id: number; name: string; applied_at: string }>(
      'SELECT id, name, applied_at FROM schema_migrations ORDER BY id',
    )
    .all()
    .map((r) => ({ id: r.id, name: r.name, appliedAt: r.applied_at }));
}

/**
 * Applies every pending migration, each in its own transaction.
 *
 * - Refuses to run if the DB contains a migration this build doesn't know
 *   (opened by a newer app version) — protects against silent downgrade.
 * - When `backupDir` is given and the DB already has applied migrations, copies
 *   the file there before changing anything.
 */
export function migrate(
  db: DB,
  list: readonly Migration[],
  opts: { dbFile?: string; backupDir?: string } = {},
): MigrationReport {
  assertWellFormed(list);
  const applied = listApplied(db);
  const known = new Set(list.map((m) => m.id));

  const unknown = applied.filter((a) => !known.has(a.id));
  if (unknown.length > 0) {
    throw new MigrationError(
      `Database was written by a newer version of Clubhouse (unknown migrations: ${unknown
        .map((u) => u.id)
        .join(', ')}). Update the app to open it.`,
    );
  }

  const appliedIds = new Set(applied.map((a) => a.id));
  const pending = list.filter((m) => !appliedIds.has(m.id));

  let backupPath: string | null = null;
  if (pending.length > 0 && applied.length > 0 && opts.dbFile && opts.backupDir) {
    mkdirSync(opts.backupDir, { recursive: true });
    db.pragma('wal_checkpoint(TRUNCATE)');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = join(opts.backupDir, `clubhouse-v${applied.at(-1)?.id ?? 0}-${stamp}.db`);
    copyFileSync(opts.dbFile, backupPath);
  }

  const record = db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)');
  for (const m of pending) {
    const run = db.transaction(() => {
      m.up(db);
      record.run(m.id, m.name);
    });
    try {
      run();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new MigrationError(`Migration ${m.id} "${m.name}" failed and was rolled back: ${reason}`);
    }
  }

  const after = listApplied(db);
  return { applied: after, schemaVersion: after.at(-1)?.id ?? 0, backupPath };
}
