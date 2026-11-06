import { contextBridge, ipcRenderer } from 'electron';
import { IPC_INVOKE } from '@shared/constants';
import type { ClubhouseBridge } from './api';

/**
 * The renderer's only door to the main process: one generic invoke over a
 * single channel. Main validates the channel name and payload, so nothing
 * here needs to trust the caller.
 */
const bridge: ClubhouseBridge = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_INVOKE, channel, input),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('clubhouse', bridge);
