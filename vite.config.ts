import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { componentLabPlugin } from './scripts/component-lab/plugin';
import { BUILD_INFO_FILE, createBuildInfo } from './server/build-info';

const git = (...args: string[]): string | null => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

const buildInfoPlugin = (): Plugin => ({
  name: 'tabletop-build-info',
  apply: 'build',
  generateBundle() {
    const info = createBuildInfo({ tag: git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*'), sha: git('rev-parse', 'HEAD'), now: new Date() });
    this.emitFile({ type: 'asset', fileName: BUILD_INFO_FILE, source: `${JSON.stringify(info)}\n` });
  },
});

export default defineConfig({
  plugins: [react(), componentLabPlugin(), buildInfoPlugin()],
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
