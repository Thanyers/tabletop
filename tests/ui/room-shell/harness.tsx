import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomShell, type RoomRecapView, type RoomTableSummary } from '../../../src/tabletop/ui/RoomShell';
import type { JoinedSource } from '../../../src/tabletop/ui/JoinedProjectionView';
import { readJoinedSources, type JoinedSourceRequest, type ProjectionResponse } from '../../../src/tabletop/ui/joined-projection-client';
import { createJoinedProjectionFetcher } from '../../../src/tabletop/ui/joined-projection-fetcher';
import { SpaceRoomScreen, type SpaceRoomDeps } from '../../../src/tabletop/ui/SpaceRoomScreen';
import type { CollaborationSpace, SpaceToolInstallation } from '../../../src/tabletop/shared/collaboration-space';
import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from '../../../src/tabletop/shared/tool-package';

/**
 * F080 / JT-V harness: the room shell (variant C) with the real client mapping in the loop.
 *
 * Only the platform fetch is scripted. URL building, status mapping and the "one failing source does
 * not hide the others" rule all run product code, and the CSS is injected from the real token file.
 */

const SPACE = '11111111-1111-4111-8111-111111111111';

const TABLES: RoomTableSummary[] = [
  { workspaceId: 'workspace-plan', title: 'ผังพื้นที่กิจกรรม', dataRevision: 4, status: 'linked' },
  { workspaceId: 'workspace-budget', title: 'งบประมาณ', dataRevision: 9, status: 'linked' },
  { workspaceId: 'workspace-people', title: 'ผู้จัดกิจกรรม', dataRevision: 2, status: 'linked' },
];

const REQUESTS: JoinedSourceRequest[] = [
  { workspaceId: 'workspace-plan', label: 'ผังพื้นที่กิจกรรม', portId: 'plan', grantId: 'grant-plan' },
  { workspaceId: 'workspace-budget', label: 'งบประมาณ', portId: 'budget', grantId: 'grant-budget' },
  { workspaceId: 'workspace-people', label: 'ผู้จัดกิจกรรม', portId: 'people', grantId: 'grant-people' },
];

function ok(portId: string, fields: string[], rows: { id: string; values: Record<string, string | number> }[], revision: number): ProjectionResponse {
  return { status: 200, body: { ok: true, portId, projection: { portId, fields, maxRows: 10 }, rows, sourceDataRevision: revision, grantVersion: 1, readAt: Date.now() } };
}

const INITIAL: Record<string, ProjectionResponse> = {
  plan: ok('plan', ['room', 'area'], [
    { id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 60 } },
    { id: 'plan-2', values: { room: 'ห้องประชุม', area: 24 } },
  ], 4),
  budget: ok('budget', ['room', 'price'], [
    { id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 5000 } },
    { id: 'cost-2', values: { room: 'ห้องประชุม', price: 1250 } },
  ], 9),
  // The third source was withdrawn at the source, which is exactly what the shell must show.
  people: { status: 409, body: { ok: false, errorCode: 'SPACE_GRANT_REVOKED' } },
};

const REFRESHED: Record<string, ProjectionResponse> = {
  plan: ok('plan', ['room', 'area'], [{ id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 72 } }], 5),
  budget: ok('budget', ['room', 'price'], [{ id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 5200 } }], 10),
};

const lastLive: Record<string, number> = {};

function Harness(): React.ReactElement {
  const [sources, setSources] = useState<JoinedSource[]>([]);
  const [script, setScript] = useState<Record<string, ProjectionResponse>>(INITIAL);
  const [activeTableId, setActiveTableId] = useState(TABLES[0]!.workspaceId);

  const read = useCallback(async (responses: Record<string, ProjectionResponse>): Promise<JoinedSource[]> => {
    const scriptedFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://tabletop.test');
      const port = url.searchParams.get('port') ?? '';
      const answer = responses[port] ?? { status: 404, body: { ok: false, errorCode: 'SPACE_SOURCE_NOT_LINKED' } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const next = await readJoinedSources(SPACE, REQUESTS, {
      fetchProjection: createJoinedProjectionFetcher({ origin: 'https://tabletop.test', fetchImpl: scriptedFetch }),
    });
    for (const source of next) {
      if (source.status === 'live') lastLive[source.portId] = source.dataRevision;
    }
    return next;
  }, []);

  useEffect(() => {
    void read(INITIAL).then(setSources);
  }, [read]);

  const refresh = async (): Promise<void> => {
    const next = { ...script, ...REFRESHED };
    setScript(next);
    setSources(await read(next));
  };

  const disconnect = async (workspaceId: string): Promise<void> => {
    const request = REQUESTS.find(entry => entry.workspaceId === workspaceId);
    if (!request) return;
    const next = { ...script, [request.portId]: { status: 409 as const, body: { ok: false, errorCode: 'SPACE_GRANT_REVOKED' } } };
    setScript(next);
    setSources(await read(next));
  };

  const reconnect = async (workspaceId: string): Promise<void> => {
    const request = REQUESTS.find(entry => entry.workspaceId === workspaceId);
    if (!request) return;
    const revision = (lastLive[request.portId] ?? 1) + 1;
    const next = { ...script, [request.portId]: ok(request.portId, ['room'], [], revision) };
    setScript(next);
    setSources(await read(next));
  };

  const live = sources.filter(source => source.status === 'live').length;
  const withdrawn = sources.filter(source => source.status === 'revoked').length;
  const recap: RoomRecapView = {
    headline: sources.length === 0
      ? 'กำลังอ่านข้อมูลจากต้นทาง'
      : `เชื่อมอยู่ ${live} แหล่ง${withdrawn > 0 ? ` · ${withdrawn} แหล่งถูกถอน` : ''}`,
    incomplete: sources.some(source => source.status === 'missing'),
    changed: sources.filter(source => source.status === 'live' && source.dataRevision > 4).length,
    withdrawn,
    unseen: true,
  };

  return (
    <RoomShell
      title="ห้องวางผังกิจกรรม"
      viewerLabel="คุณกานต์ · ผู้จัดการห้อง"
      tables={TABLES}
      activeTableId={activeTableId}
      onSelectTable={setActiveTableId}
      joinedSources={sources}
      onRefreshData={refresh}
      onDisconnectSource={disconnect}
      onReconnectSource={reconnect}
      recap={recap}
      tool={(
        <div data-testid="room-tool">
          <p style={{ margin: 0 }}>ผังรวม: ลากห้องลงโซนแล้วกดบันทึก</p>
          <button type="button" data-testid="room-tool-save" className="tt-room__table">บันทึกผัง</button>
        </div>
      )}
      authoring={(
        <p data-testid="room-authoring" style={{ margin: 0, color: 'var(--tt-muted)', fontSize: 'var(--tt-type-small)' }}>
          แก้เครื่องมือได้จากแผงผู้สร้าง (เปิดเมื่อมีสิทธิ์)
        </p>
      )}
    />
  );
}

/* ------------------------------------------------------------------------------------------------
 * F080 / D-040: the product room screen with a tool it installed, and with the referenced package.
 * ---------------------------------------------------------------------------------------------- */

const ROOM_TOOL_UI = `import { useState } from 'react';

export function Tool(props: {
  sdk: { intent: (id: string, inputs: Record<string, string | number | boolean>) => Promise<{ status: string; code?: string }> };
}) {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState('');
  const send = async () => {
    setCount((value) => value + 1);
    const outcome = await props.sdk.intent('check-room', { note: 'จากห้อง' });
    setNote(outcome.status === 'committed' ? 'บันทึกแล้ว' : 'ถูกปฏิเสธ: ' + String(outcome.code ?? 'unknown'));
  };
  return (
    <section data-testid="room-tool-package" style={{ font: '14px/1.6 system-ui, sans-serif', padding: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>ตรวจผังห้อง</h3>
      <p data-testid="room-tool-package-count" style={{ margin: '0 0 8px', fontSize: 12 }}>เรียก n = {count}</p>
      <button type="button" data-testid="room-tool-check" onClick={send} style={{ padding: '6px 12px', borderRadius: 8 }}>
        ตรวจห้อง
      </button>
      <p data-testid="room-tool-package-note" aria-live="polite" style={{ margin: '6px 0 0', fontSize: 12 }}>{note}</p>
    </section>
  );
}
`;

const ROOM_TOOL_BEHAVIOR = `export function check(inputs: Record<string, unknown>) {
  // The exported behaviour returns the change list; the isolate entry wraps it for the wire.
  return [{ target: 'self', resource: 'checks', operation: 'create', values: { note: String(inputs.note ?? '') } }];
}
`;

const ROOM_TOOL_PACKAGE: ToolPackageDefinition = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'room-planner',
  version: 2,
  title: 'เครื่องมือวางผังห้อง',
  description: 'ตรวจผังห้องจากในห้องกิจกรรม',
  uiEntry: 'ui/main.tsx',
  behaviorEntry: 'behavior/check.ts',
  files: [
    { path: 'ui/main.tsx', language: 'tsx', text: ROOM_TOOL_UI },
    { path: 'behavior/check.ts', language: 'ts', text: ROOM_TOOL_BEHAVIOR },
  ],
  ports: [],
  behaviors: [{
    id: 'check-room',
    label: 'ตรวจห้อง',
    entry: 'check',
    inputs: [{ id: 'note', label: 'หมายเหตุ', kind: 'text', required: true }],
    writes: [{ target: 'self', resource: 'checks', operations: ['create'], maxRows: 1 }],
    actions: [],
  }],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'human', authorLabel: 'room-shell fixture', createdAt: 1_760_000_000_000 },
};

/** A package whose UI entry cannot compile, so the screen must keep the card and say why. */
const ROOM_TOOL_BROKEN: ToolPackageDefinition = {
  ...ROOM_TOOL_PACKAGE,
  files: [{ path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool( {' }],
  behaviorEntry: undefined,
  behaviors: [],
};

const ROOM_TOOL_REFERENCE: Omit<SpaceToolInstallation, 'definition'> = {
  packageId: 'room-planner',
  version: 2,
  contentHash: 'c'.repeat(64),
  route: 'ai',
  title: 'เครื่องมือวางผังห้อง',
  installedBy: 'actor-b',
  installedAt: 5,
};

const SPACE_WITH_TOOL: CollaborationSpace = {
  schemaVersion: 1,
  spaceId: 'activity-room',
  title: 'ห้องวางผังกิจกรรม',
  sharedToolWorkspaceId: '33333333-3333-4333-8333-333333333333',
  managerActorId: 'actor-a',
  members: [
    { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
    { actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 2 },
  ],
  sources: [],
  revision: 3,
  epoch: 1,
  createdAt: 1,
  updatedAt: 2,
  tool: { ...ROOM_TOOL_REFERENCE, definition: ROOM_TOOL_PACKAGE },
} as CollaborationSpace;

/**
 * `?tool=reference` = a room that holds only the version reference (D-036), `?tool=broken` = an
 * installed package that does not compile, `?tool=none` = no tool at all, default = the real host.
 */
function spaceForCase(): CollaborationSpace {
  const which = new URLSearchParams(window.location.search).get('tool');
  if (which === 'none') {
    const withoutTool: CollaborationSpace = { ...SPACE_WITH_TOOL };
    delete withoutTool.tool;
    return withoutTool;
  }
  if (which === 'reference') return { ...SPACE_WITH_TOOL, tool: ROOM_TOOL_REFERENCE } as CollaborationSpace;
  if (which === 'broken') {
    return { ...SPACE_WITH_TOOL, tool: { ...ROOM_TOOL_REFERENCE, definition: ROOM_TOOL_BROKEN } } as CollaborationSpace;
  }
  return SPACE_WITH_TOOL;
}

interface RoomHarnessState {
  /** Every intent the screen forwarded to its `runToolIntent` dep. */
  intents: { behaviorId: string; inputs: Record<string, string | number | boolean> }[];
  /** How many times the screen re-read the room. */
  loads: number;
}

const roomHarness: RoomHarnessState = { intents: [], loads: 0 };
(globalThis as unknown as { __ROOM_HARNESS__: RoomHarnessState }).__ROOM_HARNESS__ = roomHarness;

function SpaceScreenHarness(): React.ReactElement {
  const fixture = spaceForCase();
  const deps: SpaceRoomDeps = {
    actorId: 'actor-a',
    viewerLabel: () => 'คุณกันต์ · ผู้จัดการห้อง',
    loadSpace: async () => {
      roomHarness.loads += 1;
      // A real load returns fresh objects; the screen must not remount the frame for that.
      return { title: fixture.title, space: structuredClone(fixture) };
    },
    loadConnections: async () => [],
    loadRecap: async () => ({ headline: 'มี 1 แหล่งข้อมูลเปลี่ยน', incomplete: false, changed: [], withdrawn: [] }),
    fetchProjection: async () => ({ status: 404, body: { ok: false, errorCode: 'SPACE_SOURCE_NOT_LINKED' } }),
    runToolIntent: async (input) => {
      roomHarness.intents.push({ behaviorId: input.behaviorId, inputs: input.inputs });
      // The route commits through the room's action path; the stub only reports that it did.
      return { ok: true, actionId: 'action-1', ack: { revision: 4, duplicate: false } };
    },
  };
  return <SpaceRoomScreen workspaceId={SPACE} deps={deps} />;
}

const container = document.getElementById('root');
if (!container) throw new Error('The room shell harness has no root element.');
container.className = 'tt-app';
createRoot(container).render(new URLSearchParams(window.location.search).get('screen') === 'space' ? <SpaceScreenHarness /> : <Harness />);
