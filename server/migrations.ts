import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SqlDatabase } from './database.js';
import { DATABASE_SCHEMA_VERSION } from './limits.js';

export type MigrationEnvironment = 'local' | 'production';

export async function migrateDatabase(database: SqlDatabase, environment: MigrationEnvironment): Promise<void> {
  if (environment !== 'local' && environment !== 'production') {
    throw new Error('MIGRATION_ENVIRONMENT_REQUIRED');
  }
  const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
  const schema = await readFile(schemaPath, 'utf8');
  await database.transaction(async (transaction) => {
    for (const statement of schema.split(';').map((item) => item.trim()).filter(Boolean)) {
      await transaction.query(statement);
    }
    await transaction.query(
      'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
      [DATABASE_SCHEMA_VERSION, Date.now()],
    );
  });
}

export async function assertSchemaReady(database: SqlDatabase): Promise<void> {
  const result = await database.query<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
  );
  if (result.rows[0]?.version !== DATABASE_SCHEMA_VERSION) throw new Error('DATABASE_SCHEMA_UNAVAILABLE');
}
