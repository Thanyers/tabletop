import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        PUBLIC_ORIGIN: 'https://tabletop.test',
        GOOGLE_OAUTH_CLIENT_ID: 'test-client.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-not-a-real-secret',
        TABLETOP_ADMIN_EMAIL: 'admin@example.test',
        DEEPSEEK_KEY: 'fixture-not-a-real-api-key',
        AI_MONTHLY_BUDGET_MICRO_USD: '1000000',
        AI_DAILY_BUDGET_MICRO_USD: '1000000',
        TEST_SCHEMA: readFileSync(new URL('./cloudflare/migrations/0001_identity.sql', import.meta.url), 'utf8'),
      },
    },
  })],
  test: {
    include: ['cloudflare/**/*.test.ts'],
    setupFiles: ['./cloudflare/test-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
