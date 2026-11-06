import { registerDataHandlers } from './handlers/data';
import { registerSystemHandlers } from './handlers/system';
import { installIpc } from './registry';

/** Registers every domain's handlers, then opens the bridge. */
export function setupIpc(): void {
  registerSystemHandlers();
  registerDataHandlers();
  installIpc();
}
