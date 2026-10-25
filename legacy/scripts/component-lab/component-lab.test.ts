import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { buildGenerationPrompt } from './prompt.ts';
import { ComponentLabJobs, createComponentLabHandler, createLoginStatusCache, safeJobError } from './plugin.ts';
import { GenerationError, validateGeneratedComponent } from './generator.ts';
import type { GenerateComponentRequest, GeneratedComponent, ModelRunResult } from './types.ts';

const validSettings = { bpm: 100, toleranceMs: 150, splitHands: false, appearance: 'violet pulse' };
const validComponent: GeneratedComponent = {
  title: 'Beat window',
  explanation: 'A visual practice meter that keeps timing judgments attached to the selected tolerance.',
  html: '<main><button data-action="start" type="button">Start practice</button><output data-role="judgment">Ready</output></main>',
  css: 'main { color: #312e81; }',
  js: `
const classify = (offsetMs, toleranceMs) => offsetMs < -toleranceMs ? 'early' : offsetMs > toleranceMs ? 'late' : 'on-time';
const start = () => {};
const stop = () => {};
const tap = (hand) => { api.setState({ settings: api.state.settings, history: api.state.history }); };
api.expose({ start, stop, tap, classify });
api.onVisibility((visible) => { if (!visible) stop(); });
api.onState((nextState) => { void nextState; });
api.ready();`,
  settings: validSettings,
};

const validInput: GenerateComponentRequest = {
  request: 'Build a focused rhythm-tapping practice meter.',
  snapshot: { settings: validSettings, history: [] },
};

const validRun: ModelRunResult = { component: validComponent, modelId: 'test-model', modelMs: 24 };

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startApiServer(
  runner: (input: GenerateComponentRequest, signal: AbortSignal) => Promise<ModelRunResult>,
  login: () => Promise<boolean> = async () => true,
): Promise<TestServer> {
  const jobs = new ComponentLabJobs(runner);
  const handler = createComponentLabHandler(jobs, login);
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    handler(request, response, () => {
      response.writeHead(404);
      response.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
  const host = address as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${host.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function jsonHeaders(baseUrl: string): HeadersInit {
  return {
    'content-type': 'application/json',
    origin: baseUrl,
    'x-component-lab': '1',
  };
}

async function postGenerate(server: TestServer, body: unknown, origin = server.baseUrl, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(`${server.baseUrl}/api/component-lab/generate`, {
    method: 'POST',
    headers: { ...jsonHeaders(origin), ...extraHeaders },
    body: JSON.stringify(body),
  });
}

async function waitForJob(server: TestServer, jobId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${server.baseUrl}/api/component-lab/jobs/${jobId}`);
    const result: unknown = await response.json();
    assert.equal(response.status, 200);
    if (typeof result === 'object' && result !== null && 'status' in result && result.status !== 'running') {
      return result as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Job did not settle in the test window.');
}

test('accepts bounded, isolated rhythm component output and rejects executable host access', () => {
  assert.deepEqual(validateGeneratedComponent(validComponent), validComponent);

  const unsafe: unknown[] = [
    { ...validComponent, html: '<button onclick="alert(1)">Start</button>' },
    { ...validComponent, html: '<iframe src="https://example.test"></iframe>' },
    { ...validComponent, css: '@import url(https://example.test/style.css);' },
    { ...validComponent, js: validComponent.js.replace('api.ready();', 'fetch("https://example.test"); api.ready();') },
    { ...validComponent, js: validComponent.js.replace('api.ready();', 'parent.location = "https://example.test"; api.ready();') },
    { ...validComponent, js: validComponent.js.replace('api.ready();', 'eval("1+1"); api.ready();') },
    { ...validComponent, js: validComponent.js.replace('api.ready();', 'document.cookie; api.ready();') },
    { ...validComponent, js: validComponent.js.replace('api.onState((nextState) => { void nextState; });', '') },
  ];
  for (const candidate of unsafe) assert.throws(() => validateGeneratedComponent(candidate), GenerationError);

  assert.throws(() => validateGeneratedComponent({ ...validComponent, settings: { ...validSettings, bpm: 241 } }), GenerationError);
  assert.throws(() => validateGeneratedComponent({ ...validComponent, settings: { ...validSettings, toleranceMs: 9 } }), GenerationError);
  assert.throws(
    () => validateGeneratedComponent({ ...validComponent, js: validComponent.js.replace('api.onState((nextState) => { void nextState; });', '') }),
    (error: unknown) => error instanceof GenerationError && error.diagnostic === 'api.onState_missing',
  );
  assert.throws(
    () => validateGeneratedComponent({ ...validComponent, settings: { ...validSettings, bpm: 241 } }),
    (error: unknown) => error instanceof GenerationError && error.diagnostic === 'settings.bpm',
  );
});

test('prompt specifies a fresh rhythm practice exercise and the host state/action contract', () => {
  const prompt = buildGenerationPrompt(validInput);
  assert.match(prompt, /genuinely new, polished rhythm-tapping practice component/);
  assert.match(prompt, /api\.expose/);
  assert.match(prompt, /performance\.now/);
  assert.match(prompt, /history entries=\{id:string,hand/);
  assert.match(prompt, /most recent 500 entries/);
  assert.match(prompt, /api\.onState\(nextState/);
  assert.match(prompt, /cloned snapshot/);
  assert.match(prompt, /Do not claim that generation itself tested/);
  assert.match(prompt, /no audio/);
});

test('status is sanitized and mutation requests require loopback, same origin, and the custom header', async () => {
  let calls = 0;
  const server = await startApiServer(async () => {
    calls += 1;
    return validRun;
  }, async () => false);
  try {
    const statusResponse = await fetch(`${server.baseUrl}/api/component-lab/status`);
    assert.deepEqual(await statusResponse.json(), {
      available: false,
      reason: 'Codex CLI is unavailable or not signed in for this local session.',
    });

    const foreignOrigin = await postGenerate(server, validInput, 'https://foreign.example');
    assert.equal(foreignOrigin.status, 403);
    const missingHeader = await postGenerate(server, validInput, server.baseUrl, { 'x-component-lab': '' });
    assert.equal(missingHeader.status, 403);

    const parsedUrl = new URL(server.baseUrl);
    const forgedHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: parsedUrl.hostname,
        port: Number(parsedUrl.port),
        path: '/api/component-lab/status',
        headers: { host: 'foreign.example' },
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('login status cache coalesces probes and refreshes after its short TTL', async () => {
  let now = 1_000;
  let calls = 0;
  let authenticated = false;
  const getStatus = createLoginStatusCache(async () => {
    calls += 1;
    return authenticated;
  }, 50, () => now);

  assert.equal(await getStatus(), false);
  assert.equal(await getStatus(), false);
  assert.equal(calls, 1);

  now += 51;
  authenticated = true;
  assert.equal(await getStatus(), true);
  assert.equal(calls, 2);

  const unsafeDetail = safeJobError(new GenerationError('invalid-output', 'api.onState_missing'));
  assert.match(unsafeDetail, /diagnostic: api\.onState_missing/);
  assert.equal(unsafeDetail.includes('function'), false);
});

test('rejects malformed, excessive, or out-of-contract state before starting a job', async () => {
  let calls = 0;
  const server = await startApiServer(async () => {
    calls += 1;
    return validRun;
  });
  try {
    const badState = await postGenerate(server, {
      ...validInput,
      snapshot: { settings: validSettings, history: [{ id: 'tap-1', hand: 'left', offsetMs: 0, at: 1, extra: true }] },
    });
    assert.equal(badState.status, 400);

    const oversize = await postGenerate(server, { ...validInput, request: 'x'.repeat(100_000) });
    assert.equal(oversize.status, 413);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('generation is single-flight, pollable, cancellable, and returns only a validated candidate', async () => {
  let startedSignal: AbortSignal | undefined;
  const server = await startApiServer((input, signal) => {
    if (input.request === 'slow') {
      startedSignal = signal;
      return new Promise<ModelRunResult>((resolve) => {
        signal.addEventListener('abort', () => resolve(validRun), { once: true });
      });
    }
    return Promise.resolve(validRun);
  });
  try {
    const slow = await postGenerate(server, { ...validInput, request: 'slow' });
    assert.equal(slow.status, 202);
    const slowBody = await slow.json() as { jobId: string };
    assert.match(slowBody.jobId, /^[0-9a-f-]{36}$/i);
    assert.ok(startedSignal);

    const concurrent = await postGenerate(server, validInput);
    assert.equal(concurrent.status, 409);

    const cancel = await fetch(`${server.baseUrl}/api/component-lab/jobs/${slowBody.jobId}`, {
      method: 'DELETE',
      headers: { origin: server.baseUrl, 'x-component-lab': '1' },
    });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json() as { status: string }).status, 'cancelled');
    assert.equal(startedSignal?.aborted, true);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const fast = await postGenerate(server, validInput);
    assert.equal(fast.status, 202);
    const fastBody = await fast.json() as { jobId: string };
    const finalJob = await waitForJob(server, fastBody.jobId);
    assert.equal(finalJob.status, 'complete');
    assert.deepEqual(finalJob.result, { ...validComponent, modelMs: 24, modelId: 'test-model' });
  } finally {
    await server.close();
  }
});

test('rejects unsafe injected generator output instead of returning it to the browser', async () => {
  const server = await startApiServer(async () => ({
    ...validRun,
    component: { ...validComponent, js: validComponent.js.replace('api.ready();', 'fetch("https://bad.test"); api.ready();') },
  }));
  try {
    const response = await postGenerate(server, validInput);
    const body = await response.json() as { jobId: string };
    const job = await waitForJob(server, body.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'The generated component did not meet the required safe output shape (diagnostic: js.network_or_worker_access). Try again.');
    assert.equal(JSON.stringify(job).includes('https://bad.test'), false);
  } finally {
    await server.close();
  }
});
