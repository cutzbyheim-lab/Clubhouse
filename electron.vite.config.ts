import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

const shared = resolve(__dirname, 'src/shared');

/**
 * The production CSP in index.html forbids inline scripts and websockets.
 * The dev server needs both (React Refresh preamble, HMR socket), so relax it
 * only while serving. Builds keep the strict policy.
 */
const cspDev: Plugin = {
  name: 'clubhouse-csp-dev',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws: http://localhost:*"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [cspDev, react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': shared,
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      outDir: 'out/renderer',
      minify: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
