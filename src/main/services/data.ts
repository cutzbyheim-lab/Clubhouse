import type { DataSummary } from '@shared/ipc/contract';
import type { DB } from '../db/connection';
import { clearSampleData, countBySource, hasSampleData, loadSampleData } from '../db/seed/sample';
import { DomainError } from '../errors';

export function dataSummary(db: DB): DataSummary {
  const own = countBySource(db, 'own');
  const sample = countBySource(db, 'sample');
  return {
    own,
    sample,
    hasSample: Object.values(sample).some((n) => n > 0),
    hasOwn: Object.values(own).some((n) => n > 0),
  };
}

export function loadSample(db: DB): DataSummary {
  if (hasSampleData(db)) throw new DomainError('CONFLICT', 'Sample data is already loaded');
  loadSampleData(db);
  return dataSummary(db);
}

export function clearSample(db: DB) {
  const { removed, kept } = clearSampleData(db);
  return { removed, kept, summary: dataSummary(db) };
}
