import { describe, expect, it } from 'vitest';
import type { SpaceToolInstallation } from '../shared/collaboration-space';
import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from '../shared/tool-package';
import { TOOL_BRIDGE_LIMITS } from '../shared/tool-protocol';
import type { JoinedSource } from './JoinedProjectionView';
import {
  compileRoomTool,
  toolInstanceId,
  toolNonce,
  toolPortSnapshots,
  toolPresentation,
} from './room-tool-hosting';

/**
 * F080 / D-040: the room's answers before it mounts a tool host.
 *
 * What the frame may see and which identity it is mounted under are decided here, so the cases that
 * matter are pinned without a browser: a package the reference does not name is refused rather than
 * rendered, a port the package did not declare never reaches the frame, and the field allowlist is the
 * declared one instead of whatever the source happened to include.
 */

const HASH = 'c'.repeat(64);
const UI_SOURCE = 'export function Tool() { return <div data-testid="marker">พร้อม</div>; }';

const PACKAGE: ToolPackageDefinition = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'room-planner',
  version: 2,
  title: 'เครื่องมือวางผังห้อง',
  description: 'ผังห้องของห้องกิจกรรม',
  uiEntry: 'ui/main.tsx',
  files: [{ path: 'ui/main.tsx', language: 'tsx', text: UI_SOURCE }],
  ports: [{ id: 'plan', label: 'ผัง', direction: 'in', kind: 'records', fields: ['room', 'area'], maxRows: 3 }],
  behaviors: [],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'human', authorLabel: 'room fixture', createdAt: 1_760_000_000_000 },
};

const TOOL: SpaceToolInstallation = {
  packageId: 'room-planner',
  version: 2,
  contentHash: HASH,
  route: 'human',
  title: 'เครื่องมือวางผังห้อง',
  installedBy: 'actor-a',
  installedAt: 1_760_000_000_000,
  definition: PACKAGE,
};

function source(overrides: Partial<JoinedSource> = {}): JoinedSource {
  return {
    workspaceId: 'workspace-plan',
    label: 'ผัง',
    portId: 'plan',
    status: 'live',
    dataRevision: 7,
    grantVersion: 4,
    readAt: 1_760_000_000_123,
    fields: ['room', 'area', 'secret'],
    rows: [
      { id: 'r1', values: { room: 'ห้องประชุม', area: 24, secret: 'x' } },
      { id: 'r2', values: { room: 'ห้องอเนกประสงค์', area: 60 } },
      { id: 'r3', values: { room: 'ห้องครัว', area: 12 } },
      { id: 'r4', values: { room: 'ระเบียง', area: 8 } },
    ],
    ...overrides,
  };
}

describe('compiling the room tool', () => {
  it('reports nothing to mount when the room has no package definition', () => {
    expect(compileRoomTool(undefined)).toEqual({ state: 'none' });
    // D-036: a room that holds only the reference keeps the installation card.
    const referenceOnly: SpaceToolInstallation = {
      packageId: TOOL.packageId,
      version: TOOL.version,
      contentHash: TOOL.contentHash,
      route: TOOL.route,
      title: TOOL.title,
      installedBy: TOOL.installedBy,
      installedAt: TOOL.installedAt,
    };
    expect(compileRoomTool(referenceOnly)).toEqual({ state: 'none' });
  });

  it('compiles the installed definition and keeps the hash the room stored', () => {
    const result = compileRoomTool(TOOL);
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    expect(result.compiled.packageId).toBe('room-planner');
    expect(result.compiled.version).toBe(2);
    expect(result.compiled.contentHash).toBe(HASH);
    expect(Object.keys(result.compiled.modules)).toContain('ui/main.tsx');
  });

  it('refuses a reference that names a different version instead of rendering it', () => {
    const result = compileRoomTool({ ...TOOL, version: 3 });
    expect(result.state).toBe('failed');
    if (result.state !== 'failed') return;
    expect(result.problems[0]?.message).toContain('does not match');
  });

  it('reports the compiler problem instead of a host', () => {
    const broken: ToolPackageDefinition = {
      ...PACKAGE,
      files: [{ path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool( {' }],
    };
    const result = compileRoomTool({ ...TOOL, definition: broken });
    expect(result.state).toBe('failed');
    if (result.state !== 'failed') return;
    expect(result.problems[0]?.code).toBe('TOOL_COMPILE_FAILED');
  });
});

describe('what one mount is called', () => {
  it('names the instance from the installed package and version', () => {
    expect(toolInstanceId(TOOL)).toBe('room-room-planner-v2');
    expect(toolInstanceId(TOOL)).toMatch(/^[a-z][a-z0-9-]{1,39}$/u);
  });

  it('gives every mount a fresh 32-hex nonce', () => {
    const first = toolNonce();
    expect(first).toMatch(/^[a-f0-9]{32}$/u);
    expect(toolNonce()).not.toBe(first);
  });
});

describe('the presentation the host promises', () => {
  it('clamps the declared rows and passes the page signals through', () => {
    expect(toolPresentation(PACKAGE, { locale: 'th', reducedMotion: true })).toEqual({
      locale: 'th',
      reducedMotion: true,
      maxRows: 3,
    });
  });

  it('promises the bridge ceiling when the package declares no records port', () => {
    expect(toolPresentation(undefined, { locale: 'en', reducedMotion: false }).maxRows).toBe(TOOL_BRIDGE_LIMITS.maxRowsPerPort);
  });
});

describe('the projections the frame may see', () => {
  it('sends a declared port with only the declared fields and the declared row ceiling', () => {
    const [snapshot] = toolPortSnapshots([source()], PACKAGE);
    expect(snapshot?.portId).toBe('plan');
    expect(snapshot?.kind).toBe('records');
    expect(snapshot?.status).toBe('live');
    expect(snapshot?.sourceLabel).toBe('ผัง');
    expect(snapshot?.revision).toEqual({ dataRevision: 7, ruleRevision: 0, grantVersion: 4, readAt: 1_760_000_000_123 });
    expect(snapshot?.rows).toHaveLength(3);
    expect(Object.keys(snapshot?.rows?.[0]?.values ?? {})).toEqual(['room', 'area']);
  });

  it('never sends a port the package did not declare', () => {
    const undeclared = source({ portId: 'budget', label: 'งบ' });
    expect(toolPortSnapshots([source(), undeclared], PACKAGE)).toHaveLength(1);
  });

  it('sends nothing when there is no installed package definition', () => {
    expect(toolPortSnapshots([source()], undefined)).toEqual([]);
  });

  it('passes a withdrawn source through as withdrawn, without its rows reaching the frame', () => {
    const [snapshot] = toolPortSnapshots([source({ status: 'revoked', rows: [] })], PACKAGE);
    expect(snapshot?.status).toBe('revoked');
    expect(snapshot?.rows).toEqual([]);
  });
});
