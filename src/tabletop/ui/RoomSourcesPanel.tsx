import { useState } from 'react';
import './room-setup.css';

/**
 * F080 / D-052: link a table into the room, and unlink one again.
 *
 * Linking is an ordinary `space.addSource` command; the source still decides whether anyone in the room
 * may read it, so this panel only chooses which table and reports what the authority answered.
 */

export interface SourceCandidate {
  workspaceId: string;
  title: string;
}

export interface LinkedSource {
  workspaceId: string;
  title: string;
  /** What the room says the source is doing: linked, left, or revoked at the source. */
  status: 'linked' | 'left' | 'revoked';
}

export interface RoomSourcesOutcome {
  ok: boolean;
  message: string;
}

export interface RoomSourcesPanelProps {
  /** The room itself, which can never be its own source. */
  roomId: string;
  /** Tables the viewer could link. */
  candidates: SourceCandidate[];
  /** What the room already references. */
  linked: LinkedSource[];
  linkSource: (workspaceId: string) => Promise<RoomSourcesOutcome>;
  unlinkSource: (workspaceId: string) => Promise<RoomSourcesOutcome>;
}

/** The candidates a person could still link: not the room itself, and not already referenced. */
export function linkableCandidates(candidates: SourceCandidate[], linked: LinkedSource[], roomId: string): SourceCandidate[] {
  const taken = new Set(linked.map(source => source.workspaceId));
  return candidates.filter(candidate => candidate.workspaceId !== roomId && !taken.has(candidate.workspaceId));
}

export function RoomSourcesPanel(props: RoomSourcesPanelProps): React.ReactElement {
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RoomSourcesOutcome | undefined>();
  const linkable = linkableCandidates(props.candidates, props.linked, props.roomId);

  const run = async (action: () => Promise<RoomSourcesOutcome>): Promise<void> => {
    setBusy(true);
    try {
      setResult(await action());
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tt-setup" data-testid="room-sources">
      <h2 className="tt-setup__title">โต๊ะที่ห้องนี้อ่านข้อมูล</h2>
      <p className="tt-setup__hint">
        การเชื่อมโต๊ะยังไม่ให้สิทธิ์อ่านข้อมูล: เจ้าของโต๊ะต้องให้สิทธิ์ที่โต๊ะต้นทางด้วย
      </p>

      {props.linked.length > 0 ? (
        <ul className="tt-setup__list" data-testid="room-sources-linked">
          {props.linked.map(source => (
            <li key={source.workspaceId} className="tt-setup__list-item">
              <span>{source.title}</span>
              <span className="tt-setup__hint">
                {source.status === 'linked' ? 'เชื่อมอยู่' : source.status === 'revoked' ? 'ถูกถอนที่ต้นทาง' : 'ออกจากห้องแล้ว'}
              </span>
              {source.status === 'linked' ? (
                <button
                  type="button"
                  className="tt-setup__submit"
                  disabled={busy}
                  onClick={() => void run(() => props.unlinkSource(source.workspaceId))}
                  data-testid={`room-sources-unlink-${source.workspaceId}`}
                >
                  ถอดออก
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tt-setup__hint" data-testid="room-sources-empty">ห้องนี้ยังไม่ได้เชื่อมโต๊ะใด</p>
      )}

      <form
        className="tt-setup__form"
        onSubmit={event => {
          event.preventDefault();
          if (busy || choice === '') return;
          void run(() => props.linkSource(choice));
        }}
      >
        <label className="tt-setup__field">
          โต๊ะที่จะเชื่อม
          <select data-testid="room-sources-select" value={choice} onChange={event => setChoice(event.target.value)} required>
            <option value="">เลือกโต๊ะ</option>
            {linkable.map(candidate => (
              <option key={candidate.workspaceId} value={candidate.workspaceId}>{candidate.title}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="tt-setup__submit" data-testid="room-sources-link" disabled={busy || choice === ''}>
          {busy ? 'กำลังเชื่อม…' : 'เชื่อมโต๊ะ'}
        </button>
      </form>

      {result ? (
        <p className={result.ok ? 'tt-setup__ok' : 'tt-setup__problem'} role="status" data-testid="room-sources-result">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
