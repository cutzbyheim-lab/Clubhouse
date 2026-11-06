import { app, BrowserWindow, dialog } from 'electron';
import { closeDatabase, initDatabase } from './db/connection';
import { migrations } from './db/migrations';
import { migrate } from './db/migrator';
import { ensureBuiltinDrills } from './db/seed/drills';
import { setupIpc } from './ipc';
import { backupsDir, dbPath } from './paths';
import { startUpdater } from './updater';
import { createMainWindow } from './window';

// Matches build.appId so Windows groups the taskbar icon and installer correctly.
if (process.platform === 'win32') app.setAppUserModelId('com.clubhouse.desktop');

function bootDatabase(): void {
  const file = dbPath();
  const db = initDatabase(file);
  const report = migrate(db, migrations, { dbFile: file, backupDir: backupsDir() });
  ensureBuiltinDrills(db);
  console.info(`[db] ${file} at schema v${report.schemaVersion}`);
  if (report.backupPath) console.info(`[db] pre-migration backup: ${report.backupPath}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    try {
      bootDatabase();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dialog.showErrorBox('Clubhouse could not open its database', message);
      app.exit(1);
      return;
    }
    setupIpc();
    createMainWindow();
    startUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => closeDatabase());
}
