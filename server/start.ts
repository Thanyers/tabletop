import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { SqlDatabase } from './database.js';
import { createPGliteDatabase, createPostgresDatabase } from './database.js';
import { assertSchemaReady, migrateDatabase, type MigrationEnvironment } from './migrations.js';
import { CommandAuthority } from './authority.js';
import { createNodeComputeRunner } from './compute-runner.js';
import type { ComputeRunner } from '../src/tabletop/shared/table-compute.js';
import { SqlWorkspaceRepository } from './repository.js';
import { createApp, type RouteExtension, type TabletopApp } from './app.js';
import { DEFAULT_HOST, DEFAULT_PORT } from './limits.js';

const localDataDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '.data');

export interface StartServerOptions {
  readonly environment?: MigrationEnvironment;
  readonly host?: string;
  readonly port?: number;
  readonly dataDir?: string;
  readonly staticDir?: string;
  readonly publicOrigin?: string;
  readonly database?: SqlDatabase;
  readonly extensions?: readonly RouteExtension[];
  readonly now?: () => number;
  readonly computeRunner?: ComputeRunner;
}

export interface StartedServer {
  readonly app: TabletopApp;
  readonly authority: CommandAuthority;
  readonly database: SqlDatabase;
  readonly repository: SqlWorkspaceRepository;
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '::1' || normalized === '::ffff:127.0.0.1'
    || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

export function validateProductionOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('PRODUCTION_ORIGIN_MUST_BE_HTTPS_ORIGIN');
    }
    return parsed.origin;
  } catch {
    throw new Error('PRODUCTION_ORIGIN_MUST_BE_HTTPS_ORIGIN');
  }
}

function environmentFrom(options: StartServerOptions): MigrationEnvironment {
  if (options.environment) return options.environment;
  const configured = process.env.TABLETOP_ENV;
  if (configured === 'local' || configured === 'production') return configured;
  if (configured) throw new Error('TABLETOP_ENV must be local or production.');
  if (process.env.NODE_ENV === 'production') throw new Error('TABLETOP_ENV_REQUIRED');
  return 'local';
}

async function defaultStaticDirectory(): Promise<string | undefined> {
  const candidate = resolve(process.cwd(), 'dist');
  try {
    if ((await stat(candidate)).isDirectory()) return candidate;
  } catch {
    return undefined;
  }
  return undefined;
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const environment = environmentFrom(options);
  const databaseUrl = process.env.DATABASE_URL;
  const host = options.host ?? (environment === 'production' ? process.env.HOST : undefined) ?? DEFAULT_HOST;
  const port = options.port ?? (process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('PORT_INVALID');
  if (environment === 'local' && !isLoopback(host)) throw new Error('LOCAL_HOST_MUST_BE_LOOPBACK');
  if (environment === 'local' && databaseUrl) {
    throw new Error('Local mode refuses DATABASE_URL; unset it or choose TABLETOP_ENV=production.');
  }
  if (environment === 'production') {
    if (!(options.host ?? process.env.HOST)) throw new Error('PRODUCTION_HOST_REQUIRED');
    if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
    const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
    if (!publicOrigin) throw new Error('PUBLIC_ORIGIN_REQUIRED');
    validateProductionOrigin(publicOrigin);
    if (options.dataDir) throw new Error('PRODUCTION_PGLITE_PATH_FORBIDDEN');
    if (port === 0) throw new Error('PRODUCTION_PORT_REQUIRED');
  }

  const ownsDatabase = options.database === undefined;
  const database = options.database ?? (environment === 'production'
    ? createPostgresDatabase(databaseUrl as string)
    : createPGliteDatabase(options.dataDir ?? localDataDirectory));
  const effectiveHost = host;
  const effectiveStaticDir = options.staticDir ?? await defaultStaticDirectory();
  const repository = new SqlWorkspaceRepository(database);

  try {
    if (environment === 'local') {
      if (database.dialect !== 'pglite') throw new Error('LOCAL_DATABASE_MUST_BE_PGLITE');
      await migrateDatabase(database, 'local');
    } else {
      if (database.dialect !== 'postgres') throw new Error('PRODUCTION_DATABASE_MUST_BE_POSTGRES');
      await assertSchemaReady(database);
    }

    const authority = new CommandAuthority({
      repository,
      secureCookies: environment === 'production',
      computeRunner: options.computeRunner ?? createNodeComputeRunner(),
      ...(options.now ? { now: options.now } : {}),
    });
    const app = createApp({
      authority,
      database,
      ...(effectiveStaticDir ? { staticDir: effectiveStaticDir } : {}),
      ...((options.publicOrigin ?? process.env.PUBLIC_ORIGIN)
        ? { publicOrigin: options.publicOrigin ?? process.env.PUBLIC_ORIGIN }
        : {}),
      ...(options.extensions ? { extensions: options.extensions } : {}),
      ...(options.now ? { now: options.now } : {}),
      expireWorkspaces: (now, limit) => repository.expireWorkspaces(now, limit),
    });
    await app.sweepExpiredWorkspaces();
    await app.dispatchPendingOutbox();
    const server = createServer(app.handler);
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;
    server.on('upgrade', (request, socket, head) => {
      void app.upgrade(request, socket, head);
    });

    await listen(server, port, effectiveHost);
    const address = server.address();
    const listeningPort = address && typeof address !== 'string' ? address.port : port;
    let closed = false;
    return {
      app,
      authority,
      database,
      repository,
      server,
      host: effectiveHost,
      port: listeningPort,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        let closeError: unknown;
        try {
          await app.close();
        } catch (error) {
          closeError = error;
        }
        try {
          if (server.listening) {
            await new Promise<void>((resolveClose, rejectClose) => {
              server.close((error) => error ? rejectClose(error) : resolveClose());
            });
          }
        } catch (error) {
          closeError ??= error;
        }
        try {
          if (ownsDatabase) await database.close();
        } catch (error) {
          closeError ??= error;
        }
        if (closeError) throw closeError;
      },
    };
  } catch (error) {
    if (ownsDatabase) await database.close().catch(() => undefined);
    throw error;
  }
}
