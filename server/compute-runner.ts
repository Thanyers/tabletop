import { spawn } from 'node:child_process';
import type { ComputeRunner } from '../src/tabletop/shared/table-compute.js';
import { COMPUTE_EXECUTION_TIMEOUT_MS, COMPUTE_WIRE_BYTES } from '../src/tabletop/shared/compute-runtime-profiles.js';
import { COMPUTE_PYTHON_ENTRY } from './compute-program.js';
import { computeWireRequest, parseComputeWireResult } from './compute-wire.js';
import { runLocalJavaScript } from './local-compute-isolate.js';

/** Local execution uses a disposable Linux container; generated Python/JS never executes on the host. */
export function createNodeComputeRunner(options: { image?: string; executable?: string } = {}): ComputeRunner {
  const image = options.image ?? 'tabletop-compute:1';
  const executable = options.executable ?? 'docker';
  return {
    async run(request, signal) {
      if (signal?.aborted) throw new Error('COMPUTE_TIMEOUT');
      if (request.runtime === 'javascript') return runLocalJavaScript(request, signal);
      const name = `tabletop-compute-${crypto.randomUUID()}`;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, COMPUTE_EXECUTION_TIMEOUT_MS);
      const command = ['python3', '-I', '-c', COMPUTE_PYTHON_ENTRY];
      try {
        const body = await new Promise<string>((resolve, reject) => {
          const child = spawn(executable, [
            'run', '--rm', '--name', name, '--interactive', '--network=none', '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=32',
            '--memory=512m', '--cpus=1', '--user=10001:10001',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=64m', image, ...command,
          ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal: controller.signal });
          const output: Buffer[] = [];
          let size = 0;
          child.stdout.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > COMPUTE_WIRE_BYTES) { controller.abort(); reject(new Error('COMPUTE_INVALID_OUTPUT')); }
            else output.push(chunk);
          });
          // Do not log input/code-bearing stderr or Docker environment details.
          child.stderr.resume();
          child.once('error', () => reject(new Error(controller.signal.aborted ? 'COMPUTE_TIMEOUT' : 'COMPUTE_UNAVAILABLE')));
          child.once('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8')) : reject(new Error('COMPUTE_FAILED')));
          child.stdin.on('error', () => undefined);
          child.stdin.end(computeWireRequest(request));
        });
        return parseComputeWireResult(body);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
        // Killing docker's client does not necessarily stop its container.
        await new Promise<void>(resolve => {
          const cleanup = spawn(executable, ['rm', '--force', name], { stdio: 'ignore', windowsHide: true });
          cleanup.once('error', () => resolve());
          cleanup.once('close', () => resolve());
          setTimeout(() => { cleanup.kill(); resolve(); }, 5_000).unref();
        });
      }
    },
  };
}
