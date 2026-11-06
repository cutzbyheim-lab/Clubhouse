import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '@shared/ipc/contract';

/*
 * Self-updating via GitHub Releases (electron-updater).
 *
 * Only active in the installed app: development runs report 'disabled'.
 * Updates download in the background and install the next time the app
 * quits, or immediately when the player clicks "Restart to update".
 * The database lives in userData, outside the install folder, so updates
 * never touch it.
 */

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'disabled', currentVersion: app.getVersion() };

const set = (patch: Partial<UpdateStatus>) => {
  status = { ...status, ...patch, currentVersion: app.getVersion() };
};

export const updateStatus = (): UpdateStatus => status;

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status;
  if (status.state === 'downloading' || status.state === 'ready') return status;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  return status;
}

export function installUpdate(): void {
  if (status.state !== 'ready') return;
  // isSilent = true (no installer UI), forceRunAfter = true (reopen Clubhouse).
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

export function startUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => console.info('[update]', m), warn: (m) => console.warn('[update]', m), error: (m) => console.error('[update]', m), debug: () => undefined };

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => {
    status = { state: 'current', currentVersion: app.getVersion() };
  });
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', availableVersion: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', availableVersion: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: err?.message ?? 'Update check failed' }));

  setTimeout(() => void checkForUpdates(), 8000);
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
}
