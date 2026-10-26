import { useCallback, useMemo, useState } from 'react';

/**
 * F080 / C6: the shared tool's data panel — several independent source tables in one tool.
 *
 * Each source keeps its own identity, revision and status. A revoked source does not silently
 * disappear and does not keep showing what it used to hold: it turns into an explicit
 * "unavailable, reconnect" row, while the tool and the other sources keep working. That is the
 * difference the plan asks for between "disconnected" and "cached forever".
 */

export type JoinedSourceStatus = 'live' | 'stale' | 'revoked' | 'missing';

export interface JoinedSource {
  /** The source workspace; used as the stable key, never shown to the user. */
  workspaceId: string;
  label: string;
  portId: string;
  status: JoinedSourceStatus;
  /** Revision the rows were read at. */
  dataRevision: number;
  /** Grant version the source answered at; absent when the read was refused. */
  grantVersion?: number;
  /** When the source authorized the read, on the source's clock; absent when refused. */
  readAt?: number;
  rows: { id: string; values: Record<string, string | number | boolean | null> }[];
  /** Columns the source grant exposes, in display order. */
  fields: string[];
}

export interface JoinedProjectionViewProps {
  title: string;
  sources: JoinedSource[];
  /** Re-reads every source; the caller owns the transport. */
  onRefresh: () => Promise<void> | void;
  /** Revokes one connection; the caller owns the transport. */
  onDisconnect: (workspaceId: string) => Promise<void> | void;
  /** Reconnects a source that lost its connection. */
  onReconnect?: (workspaceId: string) => Promise<void> | void;
}

const STATUS_TEXT: Record<JoinedSourceStatus, string> = {
  live: 'เชื่อมอยู่',
  stale: 'ข้อมูลล้าสมัย',
  revoked: 'ถูกถอนการเชื่อมต่อ',
  missing: 'ไม่พบต้นทาง',
};

const STATUS_MARK: Record<JoinedSourceStatus, string> = {
  live: '●',
  stale: '◐',
  revoked: '✕',
  missing: '∅',
};

/** Rows only mean anything while the connection is live. */
function rowsFor(source: JoinedSource): JoinedSource['rows'] {
  return source.status === 'live' || source.status === 'stale' ? source.rows : [];
}

export function JoinedProjectionView(props: JoinedProjectionViewProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const totals = useMemo(() => {
    const live = props.sources.filter(source => source.status === 'live').length;
    const rows = props.sources.reduce((sum, source) => sum + rowsFor(source).length, 0);
    return { live, total: props.sources.length, rows };
  }, [props.sources]);

  const run = useCallback(async (action: () => Promise<void> | void, message: string) => {
    setBusy(true);
    try {
      await action();
      setNote(message);
    } catch (error) {
      setNote(`ทำไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section aria-label="ข้อมูลจากหลายโต๊ะ" style={{ font: '14px/1.6 system-ui, sans-serif', display: 'grid', gap: 10 }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong data-testid="joined-title">{props.title}</strong>
        <span data-testid="joined-summary" style={{ fontSize: 12, opacity: 0.8 }}>
          {`เชื่อมอยู่ ${totals.live}/${totals.total} แหล่ง · ${totals.rows} แถว`}
        </span>
        <button type="button" data-testid="joined-refresh" disabled={busy} onClick={() => void run(props.onRefresh, 'อ่านข้อมูลใหม่แล้ว')} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 8 }}>
          อ่านข้อมูลใหม่
        </button>
      </header>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {props.sources.map(source => {
          const rows = rowsFor(source);
          const unavailable = source.status === 'revoked' || source.status === 'missing';
          return (
            <li
              key={source.workspaceId}
              data-testid={`source-${source.portId}`}
              style={{ border: '1px solid #9aa4ae', borderRadius: 10, padding: 10 }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{source.label}</strong>
                <span data-testid={`status-${source.portId}`} style={{ fontSize: 12 }}>
                  {`${STATUS_MARK[source.status]} ${STATUS_TEXT[source.status]}`}
                </span>
                <span data-testid={`revision-${source.portId}`} style={{ fontSize: 12, opacity: 0.75 }}>
                  {`rev ${source.dataRevision}`}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {unavailable ? (
                    <button type="button" data-testid={`reconnect-${source.portId}`} onClick={() => void run(() => props.onReconnect?.(source.workspaceId), 'ส่งคำขอเชื่อมใหม่แล้ว')} style={{ fontSize: 12 }}>
                      เชื่อมใหม่
                    </button>
                  ) : (
                    <button type="button" data-testid={`disconnect-${source.portId}`} onClick={() => void run(() => props.onDisconnect(source.workspaceId), `ถอนการเชื่อม ${source.label} แล้ว`)} style={{ fontSize: 12 }}>
                      ตัดการเชื่อม
                    </button>
                  )}
                </span>
              </div>

              {unavailable ? (
                <p data-testid={`unavailable-${source.portId}`} style={{ margin: '8px 0 0', fontSize: 13 }}>
                  {'ไม่พร้อมใช้ — ต้องเชื่อมต่อต้นทางใหม่ก่อนอ่านข้อมูล'}
                </p>
              ) : (
                <div style={{ overflowX: 'auto', marginTop: 8 }}>
                  <table data-testid={`rows-${source.portId}`} style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {source.fields.map(field => (
                          <th key={field} scope="col" style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #ccd3d8' }}>{field}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.id} data-testid={`row-${source.portId}-${row.id}`}>
                          {source.fields.map(field => (
                            <td key={field} style={{ padding: '4px 8px', borderBottom: '1px solid #eef1f4' }}>
                              {row.values[field] === null || row.values[field] === undefined ? '' : String(row.values[field])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 ? <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.7 }}>ยังไม่มีแถวข้อมูล</p> : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p data-testid="joined-note" aria-live="polite" style={{ margin: 0, fontSize: 12, minHeight: 18 }}>{note}</p>
    </section>
  );
}
