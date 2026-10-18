import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { startServer, type StartServerOptions } from './start.js';
import { featureRoutes } from './features.js';
import { LocalObjectStore } from './storage.js';

export async function startTabletopServer(options: StartServerOptions = {}) {
  const environment = options.environment ?? (process.env.TABLETOP_ENV === 'production' ? 'production' : 'local');
  const directory = resolve(options.dataDir ?? process.env.TABLETOP_DATA_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '.data'));
  const local = environment === 'local';
  if (local) await mkdir(directory, { recursive: true, mode: 0o700 });
  const extensions = [featureRoutes({ objects: new LocalObjectStore(resolve(directory, 'objects')), localUploads: local }), ...(options.extensions ?? [])];
  const server = await startServer({ ...options, ...(local ? { dataDir: resolve(directory, 'postgres') } : {}), extensions });
  const objects = new LocalObjectStore(resolve(directory, 'objects'));
  let sweeping = false;
  let closing = false;
  let activeSweep: Promise<void> = Promise.resolve();
  const sweep = () => {
    if (sweeping || closing || !local) return activeSweep;
    sweeping = true;
    activeSweep = (async () => {
      await server.repository.expireWorkspaces((options.now ?? Date.now)());
      for (const item of await server.repository.listPendingArtifactCleanup()) {
        await objects.remove(item.objectKey);
        await server.repository.completeArtifactCleanup(item);
      }
    })().catch(() => {
      process.stderr.write(JSON.stringify({ event: 'artifact_cleanup_retry_pending' }) + '\n');
    }).finally(() => { sweeping = false });
    return activeSweep;
  };
  await sweep();
  const cleanupTimer = setInterval(() => { void sweep() }, 5_000);
  cleanupTimer.unref();
  return { ...server, sweepArtifacts: sweep, async close() {
    if (closing) return;
    closing = true;
    clearInterval(cleanupTimer);
    await activeSweep;
    await server.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startTabletopServer();
  process.stdout.write(JSON.stringify({ event: 'tabletop_ready', url: `http://${server.host}:${server.port}` }) + '\n');
  let closing = false;
  const close = () => { if (!closing) { closing = true; void server.close().catch(() => { process.exitCode = 1 }) } };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
