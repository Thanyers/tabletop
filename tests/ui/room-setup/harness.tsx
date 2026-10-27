import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomSetupPanel, type RoomSetupResult } from '../../../src/tabletop/ui/RoomSetupPanel';
import { ToolInstallPanel, type ToolInstallOutcome } from '../../../src/tabletop/ui/ToolInstallPanel';
import { RoomSourcesPanel, type RoomSourcesOutcome } from '../../../src/tabletop/ui/RoomSourcesPanel';

/**
 * F080 / D-050, D-051 harness: both setup panels on their own, with the repo's real tokens and
 * stylesheet, so the UI gate measures the product's styling rather than a mock.
 */

function Harness(): React.ReactElement {
  const [created, setCreated] = useState<string | undefined>();

  const createRoom = async (input: { spaceId: string; title: string }): Promise<RoomSetupResult> => {
    // A refused slug is what the authority would say, so the harness can show both states.
    if (input.spaceId === 'taken') return { ok: false, message: 'A room already uses that address.' };
    return { ok: true, spaceId: input.spaceId, message: `สร้างห้องแล้ว: /s/${input.spaceId}` };
  };

  const installTool = async (tool: { packageId: string }): Promise<ToolInstallOutcome> => {
    if (tool.packageId === 'refused') return { ok: false, message: 'The room refused this package.' };
    return { ok: true, message: `ติดตั้งแล้ว: ${tool.packageId}` };
  };

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>C · room setup</h1>
      <RoomSetupPanel createRoom={createRoom} defaultTitle="Activity Room" onCreated={setCreated} />
      <p data-testid="harness-created" role="status">{created ? `host ได้รับห้อง: /s/${created}` : 'host ยังไม่ได้รับห้อง'}</p>
      <ToolInstallPanel installTool={installTool as never} />
      <RoomSourcesPanel
        roomId="room-1"
        candidates={[{ workspaceId: 'room-1', title: 'This room' }, { workspaceId: 'table-a', title: 'Plan' }, { workspaceId: 'table-b', title: 'Budget' }]}
        linked={[{ workspaceId: 'table-b', title: 'Budget', status: 'linked' }]}
        linkSource={async (): Promise<RoomSourcesOutcome> => ({ ok: true, message: 'เชื่อมโต๊ะแล้ว' })}
        unlinkSource={async (): Promise<RoomSourcesOutcome> => ({ ok: true, message: 'ถอดโต๊ะแล้ว' })}
      />
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('The room setup harness has no root element.');
createRoot(container).render(<Harness />);
