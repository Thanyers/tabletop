import { useState } from 'react';
import './room-setup.css';
import { buildGrant, readFields } from './space-grant-input';
import { keepKnownFields, type GrantResource } from './space-grant-options';

/**
 * F080 / D-054: let a room read one projection of this table.
 *
 * The grant goes to the table the owner is looking at, and it names the room by workspace id as well as
 * slug, because the authority compares the workspace. Nothing here widens a grant: fields and the row
 * cap are always chosen by the person.
 *
 * F093: the room, the resource and the fields are now picked from what this table actually has
 * (see `space-grant-options`), instead of a list of every workspace and two free-text boxes. The
 * first room is selected on open, because the common case is a table granting the one room it hosts.
 * Fields still start empty: offering the list is not the same as ticking it.
 */

export interface GrantableRoom {
  workspaceId: string;
  spaceId: string;
  title: string;
}

export interface SpaceGrantPanelProps {
  /** The table doing the granting. */
  sourceWorkspaceId: string;
  /** Rooms the owner could grant to: the space this table hosts, then spaces it already granted. */
  rooms: GrantableRoom[];
  /** Collections this table can expose. Empty when the table has no rules yet; the form then asks for text. */
  resources: GrantResource[];
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
  const [chosenRoom, setChosenRoom] = useState('');
  const [portId, setPortId] = useState('data');
  const [chosenResource, setChosenResource] = useState('');
  const [chosenFields, setChosenFields] = useState<string[]>([]);
  const [typedResource, setTypedResource] = useState('');
  const [typedFields, setTypedFields] = useState('');
  const [maxRows, setMaxRows] = useState(25);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | undefined>();

  // The first room and the first resource are the defaults, and a stale choice falls back to them
  // rather than leaving the form pointing at something that is no longer offered.
  const room = props.rooms.find(candidate => candidate.workspaceId === chosenRoom) ?? props.rooms[0];
  const fromList = props.resources.length > 0;
  const resource = props.resources.find(candidate => candidate.id === chosenResource) ?? props.resources[0];
  const fields = fromList
    ? keepKnownFields(props.resources, resource?.id ?? '', chosenFields)
    : readFields(typedFields);
  const resourceId = fromList ? resource?.id ?? '' : typedResource;

  const toggleField = (fieldId: string, on: boolean): void => {
    setChosenFields(previous => (on ? [...previous, fieldId] : previous.filter(entry => entry !== fieldId)));
  };

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
        resource: resourceId,
        fields,
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
        resource: resourceId.trim(),
        fields,
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
        การเชื่อมโต๊ะอย่างเดียวไม่ให้สิทธิ์อ่าน: เลือกเฉพาะตารางและฟิลด์ที่ยอมให้ห้องเห็น
      </p>
      {props.rooms.length === 0 ? (
        <p className="tt-setup__problem" role="status" data-testid="space-grant-no-rooms">
          โต๊ะนี้ยังไม่เกี่ยวข้องกับห้องไหน — สร้างห้องจากโต๊ะนี้ก่อน แล้วค่อยให้สิทธิ์อ่าน
        </p>
      ) : (
        <form className="tt-setup__form" onSubmit={submit}>
          {props.rooms.length > 1 ? (
            <label className="tt-setup__field">
              ห้องที่จะให้สิทธิ์
              <select
                data-testid="space-grant-room"
                value={room?.workspaceId ?? ''}
                onChange={event => setChosenRoom(event.target.value)}
                required
              >
                {props.rooms.map(candidate => (
                  <option key={`${candidate.workspaceId}-${candidate.spaceId}`} value={candidate.workspaceId}>{candidate.title}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="tt-setup__hint" data-testid="space-grant-only-room">
              ให้สิทธิ์ห้อง <strong>{room?.title}</strong>
            </p>
          )}
          <label className="tt-setup__field">
            ชื่อ port ที่ห้องจะเรียก (lowercase kebab-case)
            <input data-testid="space-grant-port" value={portId} onChange={event => setPortId(event.target.value)} maxLength={40} required />
          </label>
          {fromList ? (
            <>
              <label className="tt-setup__field">
                ตาราง (resource) ที่ให้อ่าน
                <select
                  data-testid="space-grant-resource"
                  value={resource?.id ?? ''}
                  onChange={event => { setChosenResource(event.target.value); setChosenFields([]); }}
                  required
                >
                  {props.resources.map(candidate => (
                    <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                  ))}
                </select>
              </label>
              <fieldset className="tt-setup__checks" data-testid="space-grant-fields">
                <legend>ฟิลด์ที่ให้เห็น</legend>
                {(resource?.fields ?? []).map(field => (
                  <label key={field.id} className="tt-setup__check">
                    <input
                      type="checkbox"
                      data-testid={`space-grant-field-${field.id}`}
                      checked={fields.includes(field.id)}
                      onChange={event => toggleField(field.id, event.target.checked)}
                    />
                    <span>{field.label}</span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : (
            <>
              <label className="tt-setup__field">
                ตาราง (resource) ที่ให้อ่าน
                <input data-testid="space-grant-resource" value={typedResource} onChange={event => setTypedResource(event.target.value)} required />
              </label>
              <label className="tt-setup__field">
                ฟิลด์ที่ให้เห็น (คั่นด้วยจุลภาค)
                <input data-testid="space-grant-fields" value={typedFields} onChange={event => setTypedFields(event.target.value)} placeholder="room, price" required />
              </label>
            </>
          )}
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
      )}
      {result ? (
        <p className={result.ok ? 'tt-setup__ok' : 'tt-setup__problem'} role="status" data-testid="space-grant-result">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
