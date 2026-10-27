import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { BUILD_INFO_FILE, createBuildInfo } from './server/build-info';

const git = (...args: string[]): string | null => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

// One identity per build: written to /version and baked into the bundle, so an
// open tab can tell when the server has moved on to a newer release.
const buildInfo = createBuildInfo({ tag: git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*'), sha: git('rev-parse', 'HEAD'), now: new Date() });

const buildInfoPlugin = (): Plugin => ({
  name: 'tabletop-build-info',
  apply: 'build',
  config: () => ({ define: { __TABLETOP_BUILD__: JSON.stringify(buildInfo) } }),
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: BUILD_INFO_FILE, source: `${JSON.stringify(buildInfo)}\n` });
  },
});

export default defineConfig({
  plugins: [react(), buildInfoPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        // Keep the browser Host and Origin intact for the API's same-origin checks.
        changeOrigin: false,
        ws: true,
      },
    },
    headers: { 'Content-Security-Policy': "frame-src 'self' blob:" },
  },
  build: { rollupOptions: { output: { manualChunks: { canvas: ['@xyflow/react'], charts: ['recharts'] } } } },
  test: { include: ['src/**/*.test.ts'] },
});
