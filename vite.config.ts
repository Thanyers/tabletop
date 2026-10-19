import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { componentLabPlugin } from './scripts/component-lab/plugin';
export default defineConfig({
  plugins: [react(), componentLabPlugin()],
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
