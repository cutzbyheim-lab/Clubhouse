import { registerDataHandlers } from './handlers/data';
import { registerDomainHandlers } from './handlers/domain';
import { registerSystemHandlers } from './handlers/system';
import { CHANNELS } from '@shared/ipc/contract';
import { installIpc, registeredChannels } from './registry';

/** Registers every domain's handlers, then opens the bridge. */
export function setupIpc(): void {
  registerSystemHandlers();
  registerDataHandlers();
  registerDomainHandlers();
  const missing = CHANNELS.filter((c) => !registeredChannels().includes(c));
  if (missing.length > 0) throw new Error(`IPC channels without handlers: ${missing.join(', ')}`);
  installIpc();
}
