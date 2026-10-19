import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import {
  DATABASE_LOCK_TIMEOUT_MS,
  DATABASE_POOL_SIZE,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from './limits.js';

export interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface SqlDatabase extends SqlExecutor {
  transaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
  readonly dialect: 'pglite' | 'postgres';
}

function pgliteExecutor(client: PGlite | PGliteTransaction): SqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      const result = await client.query<Row>(sql, [...parameters]);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length,
      };
    },
  };
}

type PGliteTransaction = Parameters<Parameters<PGlite['transaction']>[0]>[0];

export function createPGliteDatabase(dataDir = ':memory:'): SqlDatabase {
  const pglite = new PGlite(dataDir === ':memory:' ? 'memory://' : dataDir);
  const executor = pgliteExecutor(pglite);
  return {
    dialect: 'pglite',
    query: executor.query,
    async transaction<T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
      return pglite.transaction((transaction) => operation(pgliteExecutor(transaction)));
    },
    async ping(): Promise<void> {
      await executor.query('SELECT 1');
    },
    async close(): Promise<void> {
      await pglite.close();
    },
  };
}

export function createPostgresDatabase(databaseUrl: string): SqlDatabase {
  const pool = new Pool({ connectionString: databaseUrl, max: DATABASE_POOL_SIZE });
  const executor: SqlExecutor = {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      const result = await pool.query<Row>(sql, [...parameters]);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
  };
  return {
    dialect: 'postgres',
    query: executor.query,
    async transaction<T>(operation: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT set_config($1, $2, TRUE)', ['statement_timeout', `${DATABASE_STATEMENT_TIMEOUT_MS}ms`]);
        await client.query('SELECT set_config($1, $2, TRUE)', ['lock_timeout', `${DATABASE_LOCK_TIMEOUT_MS}ms`]);
        const transaction: SqlExecutor = {
          async query<Row extends Record<string, unknown>>(
            sql: string,
            parameters: readonly unknown[] = [],
          ): Promise<QueryResult<Row>> {
            const result = await client.query<Row>(sql, [...parameters]);
            return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
          },
        };
        const value = await operation(transaction);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async ping(): Promise<void> {
      await executor.query('SELECT 1');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export function createDatabase(options: { databaseUrl?: string; dataDir?: string }): SqlDatabase {
  if (options.databaseUrl) return createPostgresDatabase(options.databaseUrl);
  return createPGliteDatabase(options.dataDir);
}
