import { useState } from 'react';
import './room-setup.css';
import { buildGrant, readFields } from './space-grant-input';

/**
 * F080 / D-054: let a room read one projection of this table.
 *
 * The grant goes to the table the owner is looking at, and it names the room by workspace id as well as
 * slug, because the authority compares the workspace. Nothing here widens a grant: fields and the row
 * cap are always chosen by the person.
 */

export interface GrantableRoom {
  workspaceId: string;
  spaceId: string;
  title: string;
}

export interface SpaceGrantPanelProps {
  /** The table doing the granting. */
  sourceWorkspaceId: string;
  /** Rooms the owner could grant to; usually the rooms this table is linked into. */
  rooms: GrantableRoom[];
  grantProjection: (input: {
    sourceWorkspaceId: string;
    spaceWorkspaceId: string;
    spaceId: string;
    portId: string;
    resource: string;
    fields: string[];
    maxRows: number;
  }) => Promise<{ ok: boolean; message: string }>;
}

export function SpaceGrantPanel(props: SpaceGrantPanelProps): React.ReactElement {
  const [roomId, setRoomId] = useState('');
  const [portId, setPortId] = useState('data');
  const [resource, setResource] = useState('');
  const [fields, setFields] = useState('');
  const [maxRows, setMaxRows] = useState(25);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | undefined>();

  const room = props.rooms.find(candidate => candidate.workspaceId === roomId);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !room) return;
    setBusy(true);
    try {
      const built = buildGrant({
        sourceWorkspaceId: props.sourceWorkspaceId,
        spaceWorkspaceId: room.workspaceId,
        spaceId: room.spaceId,
        portId,
        resource,
        fields: readFields(fields),
        maxRows,
      });
      if (!built.ok) {
        setResult({ ok: false, message: built.problem });
        return;
      }
      setResult(await props.grantProjection({
        sourceWorkspaceId: props.sourceWorkspaceId,
        spaceWorkspaceId: room.workspaceId,
        spaceId: room.spaceId,
        portId,
        resource: resource.trim(),
        fields: readFields(fields),
        maxRows,
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tt-setup" data-testid="space-grant">
      <h2 className="tt-setup__title">ให้ห้องอ่านข้อมูลจากโต๊ะนี้</h2>
      <p className="tt-setup__hint">
        การเชื่อมโต๊ะอย่างเดียวไม่ให้สิทธิ์อ่าน: เลือกห้อง แล้วระบุเฉพาะฟิลด์ที่ยอมให้ห้องเห็น
      </p>
      <form className="tt-setup__form" onSubmit={submit}>
        <label className="tt-setup__field">
          ห้องที่จะให้สิทธิ์
          <select data-testid="space-grant-room" value={roomId} onChange={event => setRoomId(event.target.value)} required>
            <option value="">เลือกห้อง</option>
            {props.rooms.map(candidate => (
              <option key={candidate.workspaceId} value={candidate.workspaceId}>{candidate.title}</option>
            ))}
          </select>
        </label>
        <label className="tt-setup__field">
          ชื่อ port ที่ห้องจะเรียก (lowercase kebab-case)
          <input data-testid="space-grant-port" value={portId} onChange={event => setPortId(event.target.value)} maxLength={40} required />
        </label>
        <label className="tt-setup__field">
          ตาราง (resource) ที่ให้อ่าน
          <input data-testid="space-grant-resource" value={resource} onChange={event => setResource(event.target.value)} required />
        </label>
        <label className="tt-setup__field">
          ฟิลด์ที่ให้เห็น (คั่นด้วยจุลภาค)
          <input data-testid="space-grant-fields" value={fields} onChange={event => setFields(event.target.value)} placeholder="room, price" required />
        </label>
        <label className="tt-setup__field">
          จำนวนแถวสูงสุด
          <input
            data-testid="space-grant-max-rows"
            type="number"
            min={1}
            value={maxRows}
            onChange={event => setMaxRows(Number(event.target.value))}
            required
          />
        </label>
        <button type="submit" className="tt-setup__submit" data-testid="space-grant-submit" disabled={busy || room === undefined}>
          {busy ? 'กำลังให้สิทธิ์…' : 'ให้สิทธิ์ห้องนี้'}
        </button>
      </form>
      {result ? (
        <p className={result.ok ? 'tt-setup__ok' : 'tt-setup__problem'} role="status" data-testid="space-grant-result">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
