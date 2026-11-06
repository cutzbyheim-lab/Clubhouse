import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

/**
 * Opens (creating if needed) the SQLite database with the pragmas the app
 * relies on. Pure function of `path` so tests can use ':memory:'.
 */
export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  // Fail fast if the pragma silently didn't stick (e.g. inside a transaction).
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    db.close();
    throw new Error('SQLite foreign key enforcement could not be enabled');
  }
  return db;
}

let instance: DB | null = null;

export function initDatabase(path: string): DB {
  if (instance) return instance;
  instance = openDatabase(path);
  return instance;
}

export function getDatabase(): DB {
  if (!instance) throw new Error('Database accessed before initDatabase()');
  return instance;
}

export function closeDatabase(): void {
  if (!instance) return;
  instance.pragma('wal_checkpoint(TRUNCATE)');
  instance.close();
  instance = null;
}
