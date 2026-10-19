import { env } from 'cloudflare:workers';
import { beforeAll } from 'vitest';
import type { Env } from './contracts.js';

const testEnv = env as Env & { TEST_SCHEMA: string };
beforeAll(async () => {
  const statements = testEnv.TEST_SCHEMA.replace(/^--.*$/gmu, '').split(';').map((sql) => sql.trim()).filter(Boolean);
  await testEnv.DB.batch(statements.map((sql) => testEnv.DB.prepare(sql)));
});
