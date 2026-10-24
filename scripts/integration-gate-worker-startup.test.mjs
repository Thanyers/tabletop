import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runWorkerStartupGate } from './integration-gate-worker-startup.mjs';

test('the startup gate rejects a Worker module that cannot initialize', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tabletop-broken-worker-'));
  const brokenWorker = path.join(directory, 'broken-worker.js');
  try {
    await writeFile(brokenWorker, 'export default { fetch(\n', 'utf8');
    await assert.rejects(
      runWorkerStartupGate({ workerScriptPath: brokenWorker }),
      /Built Worker startup or health checks failed/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
