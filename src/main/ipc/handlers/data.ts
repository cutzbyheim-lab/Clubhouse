import { getDatabase } from '../../db/connection';
import { clearSample, dataSummary, loadSample } from '../../services/data';
import { handle } from '../registry';

export function registerDataHandlers(): void {
  handle('data.summary', () => dataSummary(getDatabase()));
  handle('data.loadSample', () => loadSample(getDatabase()));
  handle('data.clearSample', () => clearSample(getDatabase()));
}
