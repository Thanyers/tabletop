import { describe, expect, it } from 'vitest';
import { DeepSeekToolPackageGenerator, extractToolPackageJson, resolveDeepSeekKey, ToolPackageGenerationFailed } from './deepseek-tool-package';

/**
 * F080 / G1-01 + EDIT-01: the adapter is proven against the reply shape the DeepSeek endpoint sends.
 *
 * These run with an injected fetch, so no account is charged here; the same code path takes the real
 * key from the environment when one is present.
 */

const definition = {
  schemaVersion: 1,
  packageId: 'room-planner',
  version: 1,
  title: 'Room planner',
  description: 'drag rooms onto zones',
  uiEntry: 'ui/main.tsx',
  behaviorEntry: 'behavior/run.ts',
  files: [
    { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>ok</p>; }' },
    { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return { ok: true }; }' },
  ],
  ports: [{ id: 'rooms', label: 'rooms', direction: 'in', kind: 'records', fields: ['name'], maxRows: 10 }],
  behaviors: [{ id: 'allocate', label: 'allocate', entry: 'allocate', inputs: [], actions: ['reserve'], writes: [] }],
  imports: { react: '19.3.0' },
  runtimeProfile: 'tabletop-tool-1',
  provenance: { origin: 'ai', createdAt: 1_760_000_000_000 },
};

function reply(content: string, usage = { prompt_tokens: 1200, completion_tokens: 800 }) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('authoring a tool package with the DeepSeek account', () => {
  it('parses the packaged JSON and reports the usage and cost of the call', async () => {
    const generator = new DeepSeekToolPackageGenerator({ apiKey: 'k', fetch: (async () => reply(JSON.stringify(definition))) as typeof fetch });
    const result = await generator.generate({ intent: 'a room planner' });
    expect(result.definition).toMatchObject({ packageId: 'room-planner' });
    expect(result.usage).toMatchObject({ calls: 1, promptTokens: 1200, completionTokens: 800 });
    expect(result.usage.usd).toBeGreaterThan(0);
  });

  it('accepts a fenced reply, because models often wrap JSON in a code block', async () => {
    const fenced = '```json\n' + JSON.stringify(definition) + '\n```';
    const generator = new DeepSeekToolPackageGenerator({ apiKey: 'k', fetch: (async () => reply(fenced)) as typeof fetch });
    expect((await generator.generate({ intent: 'x' })).definition).toMatchObject({ packageId: 'room-planner' });
  });

  it('sends the edited package back when the person changed the source (EDIT-01)', async () => {
    let sent = '';
    const generator = new DeepSeekToolPackageGenerator({
      apiKey: 'k',
      fetch: (async (_url: string, init: RequestInit) => {
        sent = String(init.body);
        return reply(JSON.stringify(definition));
      }) as unknown as typeof fetch,
    });
    await generator.generate({ intent: 'add a note field', base: '{"packageId":"room-planner","version":7}' });
    // Read the user message rather than the raw body, which JSON-escapes the quotes.
    const body = JSON.parse(sent) as { messages: { role: string; content: string }[] };
    const user = body.messages.find(message => message.role === 'user')?.content ?? '';
    expect(user).toContain('add a note field');
    expect(user).toContain('"version":7');
  });

  it('fails closed on an empty reply, a non-JSON reply and a refused request', async () => {
    const empty = new DeepSeekToolPackageGenerator({ apiKey: 'k', fetch: (async () => reply('')) as typeof fetch });
    await expect(empty.generate({ intent: 'x' })).rejects.toBeInstanceOf(ToolPackageGenerationFailed);

    const prose = new DeepSeekToolPackageGenerator({ apiKey: 'k', fetch: (async () => reply('I cannot help with that.')) as typeof fetch });
    await expect(prose.generate({ intent: 'x' })).rejects.toMatchObject({ code: 'NOT_JSON' });

    const refused = new DeepSeekToolPackageGenerator({ apiKey: 'k', fetch: (async () => new Response('no', { status: 429 })) as typeof fetch });
    await expect(refused.generate({ intent: 'x' })).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  });

  it('refuses to call the model at all without a key', async () => {
    const generator = new DeepSeekToolPackageGenerator({ apiKey: '' });
    await expect(generator.generate({ intent: 'x' })).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  });

  it('estimates a ceiling before spending anything', () => {
    const estimate = new DeepSeekToolPackageGenerator({ apiKey: 'k' }).estimate();
    expect(estimate.calls).toBe(1);
    expect(estimate.usd).toBeGreaterThan(0);
    expect(estimate.usd).toBeLessThan(0.2);
  });

  it('keeps the outermost object when the model adds a sentence before or after it', () => {
    expect(extractToolPackageJson(`Sure! ${JSON.stringify(definition)} Hope that helps.`)).toMatchObject({ packageId: 'room-planner' });
  });

  it('finds the key in the environment first, then in the ignored .dev.vars file', () => {
    expect(resolveDeepSeekKey({ env: { DEEPSEEK_KEY: 'from-env' }, readDevVars: () => 'DEEPSEEK_KEY=from-file' }))
      .toEqual({ key: 'from-env', source: 'environment' });
    expect(resolveDeepSeekKey({ env: {}, readDevVars: () => 'DEEPSEEK_KEY="from-file"\nOTHER=1' }))
      .toEqual({ key: 'from-file', source: 'dev.vars' });
    expect(resolveDeepSeekKey({ env: {}, readDevVars: () => { throw new Error('ENOENT'); } }))
      .toEqual({ key: '', source: 'none' });
    expect(resolveDeepSeekKey({ env: { DEEPSEEK_KEY: '   ' }, readDevVars: () => 'OTHER=1' }))
      .toEqual({ key: '', source: 'none' });
  });
});
