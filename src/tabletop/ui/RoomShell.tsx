import type { ReactElement, ReactNode } from 'react';
import { JoinedProjectionView, type JoinedSource } from './JoinedProjectionView';

/**
 * F080 / JT-V — the room shell (variant C · split ledger, decision D-022).
 *
 * Three columns keep three different questions visible at once: which tables are in this room, what
 * their data looks like together, and what the shared tool plus its recap say about it. A narrow
 * screen collapses to one column instead of squeezing three.
 *
 * Everything visual comes from the tabletop tokens (`tabletop-tokens.css`); this file introduces no
 * colours, sizes or shadows of its own.
 */

export interface RoomTableSummary {
  workspaceId: string;
  title: string;
  /** Live data revision of that table, as last seen by the room. */
  dataRevision: number;
  status: 'linked' | 'left';
}

export interface RoomRecapView {
  headline: string;
  incomplete: boolean;
  changed: number;
  withdrawn: number;
  /** Reading position of the signed-in member, when known. */
  unseen?: boolean;
}

export interface RoomShellProps {
  title: string;
  /** Who is looking; a display label, never an email or an id. */
  viewerLabel: string;
  tables: RoomTableSummary[];
  activeTableId: string;
  onSelectTable: (workspaceId: string) => void;
  joinedSources: JoinedSource[];
  onRefreshData: () => Promise<void> | void;
  onDisconnectSource: (workspaceId: string) => Promise<void> | void;
  onReconnectSource?: (workspaceId: string) => Promise<void> | void;
  recap?: RoomRecapView;
  /** The shared tool for this room; rendered beside its data. */
  tool?: ReactNode;
  /** The authoring surface, shown when someone may edit the tool. */
  authoring?: ReactNode;
  /** D-053: linking and unlinking the tables this room reads. */
  sources?: ReactNode;
}

export function RoomShell(props: RoomShellProps): ReactElement {
  const active = props.tables.find(table => table.workspaceId === props.activeTableId) ?? props.tables[0];
  const linked = props.tables.filter(table => table.status === 'linked').length;

  return (
    <div className="tt-room" data-testid="room-shell">
      <header className="tt-room__bar">
        <h1 className="tt-room__title">{props.title}</h1>
        <span className="tt-room__chip" data-testid="room-linked-count">
          {`เชื่อมอยู่ ${linked}/${props.tables.length} โต๊ะ`}
        </span>
        {props.recap ? (
          <span className="tt-room__chip tt-room__chip--quiet" data-testid="room-recap-chip">
            {props.recap.incomplete ? 'ข้อมูลบางส่วนอ่านไม่ได้' : props.recap.headline}
          </span>
        ) : null}
        <span className="tt-room__viewer" data-testid="room-viewer">{props.viewerLabel}</span>
      </header>

      <div className="tt-room__body">
        <nav className="tt-room__rail" aria-label="โต๊ะในห้องนี้">
          <h2 className="tt-room__heading">โต๊ะในห้อง</h2>
          <ul className="tt-room__list">
            {props.tables.map(table => (
              <li key={table.workspaceId}>
                <button
                  type="button"
                  className="tt-room__table"
                  data-testid={`room-table-${table.workspaceId}`}
                  aria-current={table.workspaceId === active?.workspaceId ? 'true' : undefined}
                  onClick={() => props.onSelectTable(table.workspaceId)}
                >
                  <span className="tt-room__table-name">{table.title}</span>
                  <span className="tt-room__table-meta">
                    {table.status === 'linked' ? `rev ${table.dataRevision}` : 'ถูกถอดออก'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="tt-room__data" aria-label="ข้อมูลรวมจากหลายโต๊ะ">
          <h2 className="tt-room__heading">
            ข้อมูลรวม
            {active ? <span className="tt-room__heading-note">{active.title}</span> : null}
          </h2>
          <JoinedProjectionView
            title="ข้อมูลจากหลายโต๊ะ"
            sources={props.joinedSources}
            onRefresh={props.onRefreshData}
            onDisconnect={props.onDisconnectSource}
            {...(props.onReconnectSource ? { onReconnect: props.onReconnectSource } : {})}
          />
        </section>

        <aside className="tt-room__side" aria-label="เครื่องมือของห้อง">
          <h2 className="tt-room__heading">เครื่องมือ</h2>
          {props.recap ? (
            <div className="tt-room__recap" data-testid="room-recap">
              <p className="tt-room__recap-line">{props.recap.headline}</p>
              <dl className="tt-room__facts">
                <div>
                  <dt>เปลี่ยน</dt>
                  <dd data-testid="room-recap-changed">{props.recap.changed}</dd>
                </div>
                <div>
                  <dt>ถูกถอน</dt>
                  <dd data-testid="room-recap-withdrawn">{props.recap.withdrawn}</dd>
                </div>
                <div>
                  <dt>สถานะของคุณ</dt>
                  <dd data-testid="room-recap-unseen">{props.recap.unseen ? 'ยังไม่เห็นข้อมูลล่าสุด' : 'อ่านล่าสุดแล้ว'}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          {props.sources ? <div className="tt-room__sources">{props.sources}</div> : null}
          {props.tool ? <div className="tt-room__tool">{props.tool}</div> : null}
          {props.authoring ? <div className="tt-room__authoring">{props.authoring}</div> : null}
        </aside>
      </div>
    </div>
  );
}
