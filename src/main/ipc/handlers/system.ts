import { app } from 'electron';
import { APP_NAME } from '@shared/constants';
import { getDatabase } from '../../db/connection';
import { listApplied } from '../../db/migrator';
import { dbPath } from '../../paths';
import { handle } from '../registry';

export function registerSystemHandlers(): void {
  handle('app.info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
  }));

  handle('db.health', () => {
    const db = getDatabase();
    const applied = listApplied(db);
    return {
      path: dbPath(),
      sqliteVersion: db.prepare<[], { v: string }>('SELECT sqlite_version() AS v').get()?.v ?? 'unknown',
      journalMode: String(db.pragma('journal_mode', { simple: true })),
      foreignKeys: db.pragma('foreign_keys', { simple: true }) === 1,
      schemaVersion: applied.at(-1)?.id ?? 0,
      appliedMigrations: applied,
    };
  });
}
