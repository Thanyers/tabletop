import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomSetupPanel, type RoomSetupResult } from '../../../src/tabletop/ui/RoomSetupPanel';

/**
 * F080 / D-049 harness: the room setup panel on its own, with the repo's real tokens and stylesheet, so
 * the UI gate measures the product's styling rather than a mock.
 */

function Harness(): React.ReactElement {
  const [created, setCreated] = useState<string | undefined>();

  const createRoom = async (input: { spaceId: string; title: string }): Promise<RoomSetupResult> => {
    // A refused slug is what the authority would say, so the harness can show both states.
    if (input.spaceId === 'taken') return { ok: false, message: 'A room already uses that address.' };
    return { ok: true, spaceId: input.spaceId, message: `สร้างห้องแล้ว: /s/${input.spaceId}` };
  };

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18, marginTop: 0 }}>C · room setup</h1>
      <RoomSetupPanel createRoom={createRoom} defaultTitle="Activity Room" onCreated={setCreated} />
      <p data-testid="harness-created" role="status">
        {created ? `host ได้รับห้อง: /s/${created}` : 'host ยังไม่ได้รับห้อง'}
      </p>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('The room setup harness has no root element.');
createRoot(container).render(<Harness />);
