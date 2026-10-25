import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomShell, type RoomRecapView, type RoomTableSummary } from '../../../src/tabletop/ui/RoomShell';
import type { JoinedSource } from '../../../src/tabletop/ui/JoinedProjectionView';

/**
 * F080 / JT-V harness: the room shell (variant C) with synthetic data, so its layout can be measured
 * and looked at without a running Worker. The CSS is injected by the build script from the real token
 * file, so what is measured is the product's styling, not a copy of it.
 */

const TABLES: RoomTableSummary[] = [
  { workspaceId: 'workspace-plan', title: 'ผังพื้นที่กิจกรรม', dataRevision: 4, status: 'linked' },
  { workspaceId: 'workspace-budget', title: 'งบประมาณ', dataRevision: 9, status: 'linked' },
  { workspaceId: 'workspace-people', title: 'ผู้จัดกิจกรรม', dataRevision: 2, status: 'linked' },
];

const SOURCES: JoinedSource[] = [
  {
    workspaceId: 'workspace-plan', label: 'ผังพื้นที่กิจกรรม', portId: 'plan', status: 'live', dataRevision: 4,
    fields: ['room', 'area'],
    rows: [
      { id: 'plan-1', values: { room: 'ห้องอเนกประสงค์', area: 60 } },
      { id: 'plan-2', values: { room: 'ห้องประชุม', area: 24 } },
    ],
  },
  {
    workspaceId: 'workspace-budget', label: 'งบประมาณ', portId: 'budget', status: 'live', dataRevision: 9,
    fields: ['room', 'price'],
    rows: [
      { id: 'cost-1', values: { room: 'ห้องอเนกประสงค์', price: 5000 } },
      { id: 'cost-2', values: { room: 'ห้องประชุม', price: 1250 } },
    ],
  },
  {
    workspaceId: 'workspace-people', label: 'ผู้จัดกิจกรรม', portId: 'people', status: 'revoked', dataRevision: 2,
    fields: ['name', 'role'],
    rows: [{ id: 'p-1', values: { name: 'กานต์', role: 'ผู้จัดการ' } }],
  },
];

function Harness(): React.ReactElement {
  const [sources, setSources] = useState<JoinedSource[]>(SOURCES);
  const [activeTableId, setActiveTableId] = useState(TABLES[0]!.workspaceId);

  const refresh = async (): Promise<void> => {
    setSources(current => current.map(source => (source.status === 'live'
      ? { ...source, dataRevision: source.dataRevision + 1 }
      : source)));
  };

  const disconnect = async (workspaceId: string): Promise<void> => {
    setSources(current => current.map(source => (source.workspaceId === workspaceId
      ? { ...source, status: 'revoked', rows: [] }
      : source)));
  };

  const reconnect = async (workspaceId: string): Promise<void> => {
    setSources(current => current.map(source => (source.workspaceId === workspaceId
      ? { ...source, status: 'live', dataRevision: source.dataRevision + 1 }
      : source)));
  };

  const recap: RoomRecapView = {
    headline: 'มี 1 แหล่งข้อมูลเปลี่ยนหลังเชื่อม · 1 แหล่งถูกถอน',
    incomplete: false,
    changed: sources.filter(source => source.status === 'live' && source.dataRevision > 4).length,
    withdrawn: sources.filter(source => source.status === 'revoked').length,
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

const container = document.getElementById('root');
if (!container) throw new Error('The room shell harness has no root element.');
container.className = 'tt-app';
createRoot(container).render(<Harness />);
