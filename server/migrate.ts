import { resolve } from 'node:path';
import { createDatabase } from './database.js';
import { migrateDatabase, type MigrationEnvironment } from './migrations.js';

function parseArguments(argumentsList: readonly string[]): { environment: MigrationEnvironment; dataDir?: string } {
  const environmentIndex = argumentsList.indexOf('--environment');
  const environment = environmentIndex >= 0 ? argumentsList[environmentIndex + 1] : undefined;
  if (environment !== 'local' && environment !== 'production') {
    throw new Error('Use --environment local or --environment production.');
  }
  const dataIndex = argumentsList.indexOf('--data-dir');
  const dataDir = dataIndex >= 0 ? argumentsList[dataIndex + 1] : undefined;
  return { environment, dataDir: dataDir ? resolve(dataDir) : undefined };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (options.environment === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL is required for an explicit production migration.');
  }
  if (options.environment === 'local' && databaseUrl) {
    throw new Error('Local migration refuses DATABASE_URL; unset it or choose --environment production.');
  }
  const database = createDatabase({ databaseUrl, dataDir: options.dataDir });
  try {
    await migrateDatabase(database, options.environment);
    process.stdout.write(`Schema ${options.environment} migration complete.\n`);
  } finally {
    await database.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'MIGRATION_FAILED';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
