import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/main/db/connection';
import { migrate, MigrationError } from '../src/main/db/migrator';
import type { Migration } from '../src/main/db/migrations/types';

const m1: Migration = {
  id: 1,
  name: 'create_club',
  up: (db) => db.exec('CREATE TABLE club (id INTEGER PRIMARY KEY, label TEXT NOT NULL) STRICT'),
};
const m2: Migration = {
  id: 2,
  name: 'add_loft',
  up: (db) => db.exec('ALTER TABLE club ADD COLUMN loft_deg REAL'),
};
const broken: Migration = {
  id: 3,
  name: 'broken',
  up: (db) => {
    db.exec('CREATE TABLE half_done (id INTEGER PRIMARY KEY)');
    throw new Error('boom');
  },
};

const tableExists = (db: DB, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('migrate', () => {
  it('applies pending migrations in order and records them', () => {
    const db = openDatabase(':memory:');
    const report = migrate(db, [m1, m2]);
    expect(report.schemaVersion).toBe(2);
    expect(report.applied.map((a) => a.name)).toEqual(['create_club', 'add_loft']);
    db.prepare('INSERT INTO club (label, loft_deg) VALUES (?, ?)').run('7 Iron', 30);
  });

  it('is idempotent', () => {
    const db = openDatabase(':memory:');
    migrate(db, [m1, m2]);
    expect(migrate(db, [m1, m2]).applied).toHaveLength(2);
  });

  it('rolls back a failing migration completely and keeps earlier ones', () => {
    const db = openDatabase(':memory:');
    expect(() => migrate(db, [m1, m2, broken])).toThrow(MigrationError);
    expect(tableExists(db, 'club')).toBe(true);
    expect(tableExists(db, 'half_done')).toBe(false);
    expect(migrate(db, [m1, m2]).schemaVersion).toBe(2);
  });

  it('refuses to open a database written by a newer version', () => {
    const db = openDatabase(':memory:');
    migrate(db, [m1, m2]);
    expect(() => migrate(db, [m1])).toThrow(/newer version/);
  });

  it('rejects out-of-order migration lists', () => {
    const db = openDatabase(':memory:');
    expect(() => migrate(db, [m2, m1])).toThrow(/strictly increase/);
  });

  it('backs up an existing database before applying new migrations', () => {
    dir = mkdtempSync(join(tmpdir(), 'clubhouse-'));
    const file = join(dir, 'test.db');
    const db = openDatabase(file);
    expect(migrate(db, [m1], { dbFile: file, backupDir: join(dir, 'bk') }).backupPath).toBeNull();
    const report = migrate(db, [m1, m2], { dbFile: file, backupDir: join(dir, 'bk') });
    expect(report.backupPath).not.toBeNull();
    expect(existsSync(report.backupPath ?? '')).toBe(true);
    db.close();
  });

  it('enforces foreign keys on every connection', () => {
    const db = openDatabase(':memory:');
    db.exec(`
      CREATE TABLE bag (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE club (id INTEGER PRIMARY KEY, bag_id INTEGER NOT NULL REFERENCES bag(id)) STRICT;
    `);
    expect(() => db.prepare('INSERT INTO club (bag_id) VALUES (99)').run()).toThrow(/FOREIGN KEY/);
  });
});
