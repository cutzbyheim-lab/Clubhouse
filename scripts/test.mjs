#!/usr/bin/env node
/**
 * Runs Vitest inside Electron's own Node runtime (ELECTRON_RUN_AS_NODE), so
 * tests load the exact native SQLite binary the app ships with. Works the
 * same on Windows, macOS and Linux.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron'); // path to the Electron binary
// vitest.mjs isn't in the package's exports map, so resolve it next to package.json.
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const r = spawnSync(electron, [vitest, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(r.status ?? 1);
