import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JoinedProjectionView, type JoinedSource } from '../../../src/tabletop/ui/JoinedProjectionView';
import { readJoinedSources, type JoinedSourceRequest, type ProjectionResponse } from '../../../src/tabletop/ui/joined-projection-client';

/**
 * F080 / C6 harness: the joined panel wired through the real client mapping.
 *
 * Only the HTTP call is faked. The status mapping, the "one failing source does not hide the
 * others" rule and the row/revision handling all run the same code the product would use.
 */

const SPACE = '11111111-1111-4111-8111-111111111111';
const REQUESTS: JoinedSourceRequest[] = [
  { workspaceId: 'workspace-plan', label: 'ผังกิจกรรม', portId: 'plan', grantId: 'grant-plan' },
  { workspaceId: 'workspace-budget', label: 'งบประมาณ', portId: 'budget', grantId: 'grant-budget' },
];

function ok(portId: string, fields: string[], rows: { id: string; values: Record<string, string | number> }[], revision: number): ProjectionResponse {
  return { status: 200, body: { ok: true, portId, projection: { portId, fields, maxRows: 10 }, rows, sourceDataRevision: revision, grantVersion: 1, readAt: Date.now() } };
}

const INITIAL: Record<string, ProjectionResponse> = {
  plan: ok('plan', ['room', 'area'], [
    { id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 60 } },
    { id: 'plan-2', values: { room: 'ห้องประชุม', area: 24 } },
  ], 3),
  budget: ok('budget', ['room', 'price'], [
    { id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 4200 } },
    { id: 'cost-2', values: { room: 'ห้องประชุม', price: 1250 } },
  ], 7),
};

const REFRESHED: Record<string, ProjectionResponse> = {
  plan: ok('plan', ['room', 'area'], [{ id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 72 } }], 4),
  budget: ok('budget', ['room', 'price'], [{ id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 5000 } }], 9),
};

interface HarnessLog { reads: number; disconnects: string[]; reconnects: string[] }
/** Last revision each port was seen at while live, so a reconnect can advance it. */
const lastLiveRevision: Record<string, number> = {};
const log: HarnessLog = { reads: 0, disconnects: [], reconnects: [] };
(globalThis as unknown as { __JOINED__: HarnessLog }).__JOINED__ = log;

function Harness(): React.ReactElement {
  const [sources, setSources] = useState<JoinedSource[]>([]);
  /** Responses the fake transport will answer with; the panel never sees this map. */
  const [script, setScript] = useState<Record<string, ProjectionResponse>>(INITIAL);

  const read = useCallback(async (responses: Record<string, ProjectionResponse>): Promise<JoinedSource[]> => {
    const sources = await readJoinedSources(SPACE, REQUESTS, {
      fetchProjection: async input => responses[input.port] ?? { status: 404, body: { ok: false, errorCode: 'SPACE_SOURCE_NOT_LINKED' } },
    });
    for (const source of sources) {
      if (source.status === 'live' || source.status === 'stale') lastLiveRevision[source.portId] = source.dataRevision;
    }
    return sources;
  }, []);

  useEffect(() => {
    void read(INITIAL).then(setSources);
  }, [read]);

  const refresh = async (): Promise<void> => {
    log.reads += 1;
    // A real re-read: both sources moved. Only the live ones are re-asked in the product; here the
    // script models that by answering with the refreshed payloads.
    const next = { ...script, ...REFRESHED };
    setScript(next);
    setSources(await read(next));
  };

  const disconnect = async (workspaceId: string): Promise<void> => {
    log.disconnects.push(workspaceId);
    // The transport now refuses this source, which is what the mapping has to turn into "revoked".
    const port = REQUESTS.find(request => request.workspaceId === workspaceId)?.portId;
    if (!port) return;
    const next = { ...script, [port]: { status: 409, body: { ok: false, errorCode: 'SPACE_GRANT_REVOKED' } } };
    setScript(next);
    setSources(await read(next));
  };

  const reconnect = async (workspaceId: string): Promise<void> => {
    log.reconnects.push(workspaceId);
    const request = REQUESTS.find(entry => entry.workspaceId === workspaceId);
    if (!request) return;
    const revision = (lastLiveRevision[request.portId] ?? 0) + 1;
    const next = { ...script, [request.portId]: ok(request.portId, ['room'], [], revision) };
    setScript(next);
    setSources(await read(next));
  };

  return (
    <main style={{ font: '14px/1.6 system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>C6 — joined data panel</h1>
      <JoinedProjectionView title="ผังพื้นที่กิจกรรม" sources={sources} onRefresh={refresh} onDisconnect={disconnect} onReconnect={reconnect} />
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('The joined harness has no root element.');
createRoot(container).render(<Harness />);
