import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JoinedProjectionView, type JoinedSource } from '../../../src/tabletop/ui/JoinedProjectionView';

/**
 * F080 / C6 harness: the joined data panel with the transport replaced by an in-page fake.
 *
 * The point is the state machine the plan cares about: two independent sources with their own
 * revisions, a refresh that re-reads, and a disconnect that stops showing the revoked rows while
 * the tool and the other source keep working.
 */

const INITIAL: JoinedSource[] = [
  {
    workspaceId: 'workspace-plan',
    label: 'ผังกิจกรรม',
    portId: 'plan',
    status: 'live',
    dataRevision: 3,
    fields: ['room', 'area'],
    rows: [
      { id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 60 } },
      { id: 'plan-2', values: { room: 'ห้องประชุม', area: 24 } },
    ],
  },
  {
    workspaceId: 'workspace-budget',
    label: 'งบประมาณ',
    portId: 'budget',
    status: 'live',
    dataRevision: 7,
    fields: ['room', 'price'],
    rows: [
      { id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 4200 } },
      { id: 'cost-2', values: { room: 'ห้องประชุม', price: 1250 } },
    ],
  },
];

const REFRESHED: Record<string, { dataRevision: number; rows: JoinedSource['rows'] }> = {
  'workspace-plan': { dataRevision: 4, rows: [{ id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 72 } }] },
  'workspace-budget': { dataRevision: 9, rows: [{ id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 5000 } }] },
};

interface HarnessLog { reads: number; disconnects: string[]; reconnects: string[] }
const log: HarnessLog = { reads: 0, disconnects: [], reconnects: [] };
(globalThis as unknown as { __JOINED__: HarnessLog }).__JOINED__ = log;

function Harness(): React.ReactElement {
  const [sources, setSources] = useState<JoinedSource[]>(INITIAL);

  const refresh = async (): Promise<void> => {
    log.reads += 1;
    // Simulates a live re-read: both sources moved and one row disappeared.
    setSources(current => current.map(source => {
      if (source.status === 'revoked' || source.status === 'missing') return source;
      const next = REFRESHED[source.workspaceId];
      return next ? { ...source, dataRevision: next.dataRevision, rows: next.rows, status: 'live' as const } : source;
    }));
  };

  const disconnect = async (workspaceId: string): Promise<void> => {
    log.disconnects.push(workspaceId);
    setSources(current => current.map(source => (
      source.workspaceId === workspaceId
        // The rows are dropped, not kept as "last known values".
        ? { ...source, status: 'revoked' as const, rows: [] }
        : source
    )));
  };

  const reconnect = async (workspaceId: string): Promise<void> => {
    log.reconnects.push(workspaceId);
    setSources(current => current.map(source => (
      source.workspaceId === workspaceId ? { ...source, status: 'live' as const, dataRevision: source.dataRevision + 1 } : source
    )));
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
