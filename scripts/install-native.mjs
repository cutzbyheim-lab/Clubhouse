#!/usr/bin/env node
/**
 * Makes better-sqlite3 loadable inside Electron.
 *
 * 1. Try the official prebuilt binary for the installed Electron's ABI
 *    (downloaded from the better-sqlite3 GitHub release — no compiler needed).
 * 2. Fall back to compiling against Electron's headers with @electron/rebuild.
 *
 * Electron and better-sqlite3 are pinned to a pairing that has a prebuild, so
 * step 2 should only run on unusual platforms.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const sqliteDir = dirname(require.resolve('better-sqlite3/package.json'));
const electronVersion = require('electron/package.json').version;
const binary = join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  return r.status === 0;
}

const prebuildBin = require.resolve('prebuild-install/bin.js', { paths: [sqliteDir] });
console.log(`[native] fetching better-sqlite3 prebuild for Electron ${electronVersion}`);
const prebuilt = run(
  process.execPath,
  [prebuildBin, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`],
  sqliteDir,
);

if (prebuilt && existsSync(binary)) {
  console.log('[native] using prebuilt binary');
  process.exit(0);
}

console.log('[native] no prebuild available — compiling with @electron/rebuild');
const rebuildBin = require.resolve('@electron/rebuild/lib/cli.js');
process.exit(run(process.execPath, [rebuildBin, '-f', '-w', 'better-sqlite3']) ? 0 : 1);
