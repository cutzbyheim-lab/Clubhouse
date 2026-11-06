import { join } from 'node:path';
import { app } from 'electron';
import { DB_FILENAME } from '@shared/constants';

/** CLUBHOUSE_DATA_DIR overrides userData — used by tests and headless runs. */
export const dataDir = (): string => process.env['CLUBHOUSE_DATA_DIR'] ?? app.getPath('userData');

export const dbPath = (): string => join(dataDir(), DB_FILENAME);

export const backupsDir = (): string => join(dataDir(), 'backups');
