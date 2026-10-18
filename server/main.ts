import { startServer } from './start.js';

async function main(): Promise<void> {
  const server = await startServer();
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'server_listening', host: server.host, port: server.port })}\n`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await server.close();
  };

  process.once('SIGINT', () => { void stop().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void stop().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'SERVER_START_FAILED';
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'server_start_failed', errorCode: message })}\n`);
  process.exitCode = 1;
});
