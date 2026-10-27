import { describe, expect, it } from 'vitest';
import { TOOL_SANDBOX_ORIGIN_MAX_LENGTH, readToolSandboxOrigin } from './tool-sandbox-origin';

// F080 / D-044: one rule set, applied by the Worker before it publishes the field and by the client
// before it frames anything. Every case below is a value an operator or a stale deploy could produce.

const appOrigin = 'https://tabletop.test';
const validOrigin = 'https://tabletop-sandbox-staging.ptchrr.workers.dev';
const sandboxHost = 'tabletop-sandbox-staging.ptchrr.workers.dev';

/** Values the Worker must not publish and the client must not frame. */
const refusedOrigins: [label: string, problem: string, value: unknown][] = [
  ['a value that is not a URL', 'not-a-url', 'tabletop-sandbox-staging.ptchrr.workers.dev'],
  ['an http origin', 'not-https', `http://${sandboxHost}`],
  ['a non-web scheme', 'not-https', 'javascript:alert(1)'],
  ['a value carrying credentials', 'credentials', `https://user:secret@${sandboxHost}`],
  ['a value carrying a query', 'query', `${validOrigin}?debug=1`],
  ['a value carrying a fragment', 'fragment', `${validOrigin}#top`],
  ['a value carrying a path', 'not-an-origin', `${validOrigin}/frame.html`],
  ['a value carrying a port', 'not-an-origin', `https://${sandboxHost}:8443`],
  ['a value over the length limit', 'too-long', `https://${'a'.repeat(TOOL_SANDBOX_ORIGIN_MAX_LENGTH)}.workers.dev`],
  ['a host that is neither the app nor workers.dev', 'untrusted-host', 'https://sandbox.example.test'],
  ['a host that only looks like workers.dev', 'untrusted-host', 'https://not-a-workers.dev'],
];

describe('F080 / D-044 tool sandbox origin', () => {
  it('accepts a bare https origin on a workers.dev host', () => {
    expect(readToolSandboxOrigin(validOrigin, appOrigin)).toEqual({ ok: true, origin: validOrigin });
  });

  it('accepts the app host, so one deployment can serve both origins', () => {
    expect(readToolSandboxOrigin(appOrigin, appOrigin)).toEqual({ ok: true, origin: appOrigin });
  });

  it('treats an absent value, and an empty one, as the default rather than a fault', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(readToolSandboxOrigin(value, appOrigin)).toEqual({ ok: false, problem: 'absent' });
    }
  });

  it.each(refusedOrigins)('refuses %s', (_label, problem, value) => {
    expect(readToolSandboxOrigin(value, appOrigin)).toEqual({ ok: false, problem });
  });

  it('refuses a value that is not a string instead of throwing', () => {
    for (const value of [42, true, { origin: validOrigin }, [validOrigin]]) {
      expect(readToolSandboxOrigin(value, appOrigin)).toEqual({ ok: false, problem: 'not-a-url' });
    }
  });

  it('accepts a workers.dev origin when the app origin is not known', () => {
    expect(readToolSandboxOrigin(validOrigin, '')).toEqual({ ok: true, origin: validOrigin });
    expect(readToolSandboxOrigin('https://sandbox.example.test', '')).toEqual({ ok: false, problem: 'untrusted-host' });
  });
});
