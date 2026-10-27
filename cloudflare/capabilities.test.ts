import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from './contracts.js';
import worker from './index.js';

// F080 / D-044: the Worker publishes the sandbox origin only when it can vouch for it. Nothing here
// may change the endpoint's answer when the variable is absent, and a bad value must never make the
// endpoint fail or the app frame an origin nobody reviewed.

const bindings = env as Env;
const origin = 'https://tabletop.test';
const sandboxHost = 'tabletop-sandbox-staging.ptchrr.workers.dev';
const validOrigin = `https://${sandboxHost}`;

/** `/api/capabilities` as a caller sees it, with one fixture value for the optional binding. */
async function capabilities(toolSandboxOrigin?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const fixture = (toolSandboxOrigin === undefined ? bindings : { ...bindings, TOOL_SANDBOX_ORIGIN: toolSandboxOrigin }) as Env;
  const response = await worker.fetch(new Request(`${origin}/api/capabilities`), fixture);
  return { status: response.status, body: await response.json<Record<string, unknown>>() };
}

const malformed: [label: string, value: unknown][] = [
  ['an http origin', `http://${sandboxHost}`],
  ['an origin carrying credentials', `https://user:secret@${sandboxHost}`],
  ['an origin carrying a query', `${validOrigin}?debug=1`],
  ['an origin carrying a fragment', `${validOrigin}#top`],
  ['an origin carrying a path', `${validOrigin}/frame.html`],
  ['an origin that is too long', `https://${'a'.repeat(200)}.workers.dev`],
  ['a host that is neither the app nor workers.dev', 'https://sandbox.example.test'],
  ['a value that is not a URL', sandboxHost],
];

describe('F080 / D-044 sandbox origin in /api/capabilities', () => {
  // First in the file on purpose: the warning flag lives for one isolate, and this is the only test
  // that reads it.
  it('reports an unusable value once, without echoing it, and still answers', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = await capabilities(`http://${sandboxHost}`);
      const second = await capabilities(`http://${sandboxHost}`);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(warning).toHaveBeenCalledTimes(1);
      const logged = String(warning.mock.calls[0]?.[0] ?? '');
      expect(logged).toContain('not-https');
      // A bounded line names the reason, never the value an operator typed.
      expect(logged).not.toContain(sandboxHost);
    } finally {
      warning.mockRestore();
    }
  });

  it('publishes a valid workers.dev origin', async () => {
    const { status, body } = await capabilities(validOrigin);
    expect(status).toBe(200);
    expect(body.toolSandboxOrigin).toBe(validOrigin);
    // The rest of the payload is untouched by the new field.
    expect(body).toMatchObject({ uploads: false, images: true, inviteLinks: true, tableAssistant: { available: true } });
  });

  it('publishes the app host as the sandbox origin', async () => {
    const { body } = await capabilities(origin);
    expect(body.toolSandboxOrigin).toBe(origin);
  });

  it('omits the field when the variable is absent', async () => {
    const { status, body } = await capabilities();
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('toolSandboxOrigin');
  });

  it.each(malformed)('omits %s and still answers 200', async (_label, value) => {
    const { status, body } = await capabilities(value);
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('toolSandboxOrigin');
    expect(body).toMatchObject({ uploads: false, tableAssistant: { available: true } });
  });
});
