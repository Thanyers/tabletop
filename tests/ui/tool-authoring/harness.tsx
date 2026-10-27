import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authorToolPackage, type ToolAuthoringResult } from '../../../src/tabletop/runtime/tools/authoring';
import type { CompiledToolPackage } from '../../../src/tabletop/runtime/tools/compile';
import { TOOL_PACKAGE_PINNED_IMPORTS, TOOL_PACKAGE_RUNTIME_PROFILE, TOOL_PACKAGE_SCHEMA_VERSION, type ToolPackageDefinition } from '../../../src/tabletop/shared/tool-package';
import { ToolAuthoringPanel } from '../../../src/tabletop/ui/ToolAuthoringPanel';

/**
 * F080 / C3 harness: the real authoring panel wired to the real pipeline.
 *
 * The trial here is a syntax gate over the compiled modules. That is deliberate and limited: it
 * proves the pipeline reaches activation with a compiled artifact, while isolated execution is
 * proven separately by the workerd runner tests. Treating this harness as isolation evidence would
 * be wrong, so it does not claim to be.
 */

function fixtureHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

const UI_SOURCE = `export function Tool() {
  return <p>ผังกิจกรรม</p>;
}
`;

const BASE: ToolPackageDefinition = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'activity-layout',
  version: 1,
  title: 'ผังพื้นที่กิจกรรม',
  description: 'ลากห้องลงโซน',
  uiEntry: 'ui/main.tsx',
  behaviorEntry: 'behavior/run.ts',
  files: [
    { path: 'ui/main.tsx', language: 'tsx', text: UI_SOURCE },
    { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate() { return []; }\n' },
  ],
  ports: [{ id: 'plan', label: 'ผัง', direction: 'in', kind: 'records', fields: ['room'], maxRows: 20 }],
  behaviors: [{ id: 'allocate', label: 'จัดสรร', entry: 'allocate', inputs: [], writes: [{ target: 'self', resource: 'placements', operations: ['create'], maxRows: 10 }] }],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'human', createdAt: 1_760_000_000_000 },
};

interface HarnessLog {
  activations: ToolAuthoringResult[];
  hashes: string[];
  /** What the panel handed the pipeline, so the continuation can be checked at the call boundary. */
  calls: { route: 'ai' | 'human'; baseContentHash: string | null; version: number | null }[];
}

const log: HarnessLog = { activations: [], hashes: [], calls: [] };
(globalThis as unknown as { __AUTHORING__: HarnessLog }).__AUTHORING__ = log;

async function trial(compiled: CompiledToolPackage): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  for (const [path, source] of Object.entries(compiled.modules)) {
    try {
      // Syntax gate only: this is not an isolation boundary (see the file comment).
      new Function(source);
    } catch (error) {
      return { ok: false, problems: [`${path}: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
  return { ok: true };
}

const AI_ROUTE = new URLSearchParams(window.location.search).get('route') === 'ai';

function Harness(): React.ReactElement {
  const [activated, setActivated] = useState<{ version: number; hash: string } | undefined>();

  const author = async (definition: unknown, baseContentHash: string | undefined): Promise<ToolAuthoringResult> => {
    log.calls.push({
      route: AI_ROUTE ? 'ai' : 'human',
      baseContentHash: baseContentHash ?? null,
      version: typeof (definition as { version?: unknown }).version === 'number' ? (definition as { version: number }).version : null,
    });
    // G1-01: the same panel drives the AI route when a generator is supplied. Here the "model" is a
    // fixture so the browser proof costs nothing; the pipeline, the route and the record are the real ones.
    if (AI_ROUTE) {
      const result = await authorToolPackage(
        {
          route: { kind: 'ai', actorId: 'actor-generator', prompt: 'make a room planner', ...(baseContentHash ? { baseContentHash } : {}) },
          reviewer: { kind: 'manual', actorId: 'actor-editor' },
          budget: { maxCalls: 3, maxUsd: 0.2, usedCalls: 0, usedUsd: 0 },
        },
        {
          trial,
          hash: fixtureHash,
          now: 1_760_000_100_000,
          maxRepairAttempts: 1,
          generator: {
            id: 'fixture-generator',
            estimate: () => ({ calls: 1, usd: 0.01 }),
            generate: async () => ({ definition, usage: { calls: 1, usd: 0.01 } }),
          } as never,
        },
      );
      log.activations.push(result);
      if (result.ok) log.hashes.push(result.contentHash);
      return result;
    }

    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-editor', definition, ...(baseContentHash ? { baseContentHash } : {}) }, reviewer: { kind: 'manual', actorId: 'actor-editor' } },
      { trial, hash: fixtureHash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    log.activations.push(result);
    if (result.ok) log.hashes.push(result.contentHash);
    return result;
  };

  return (
    <main style={{ font: '14px/1.6 system-ui, sans-serif', maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>C3 — authoring panel</h1>
      <ToolAuthoringPanel
        initial={BASE}
        actorId="actor-editor"
        author={author}
        onActivated={(definition, contentHash) => setActivated({ version: definition.version, hash: contentHash })}
      />
      <p data-testid="host-readback" style={{ fontSize: 12, marginTop: 12 }}>
        {activated ? `host ได้รับ: v${activated.version} ${activated.hash.slice(0, 8)}…` : 'host ยังไม่ได้รับ activation'}
      </p>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('The authoring harness has no root element.');
createRoot(container).render(<Harness />);
