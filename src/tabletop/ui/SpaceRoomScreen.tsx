import { useCallback, useEffect, useState } from 'react';
import type { CollaborationSpace } from '../shared/collaboration-space';
import type { JoinedSource } from './JoinedProjectionView';
import type { JoinedReadDeps } from './joined-projection-client';
import { readJoinedSources } from './joined-projection-client';
import { RoomShell, type RoomRecapView, type RoomTableSummary } from './RoomShell';

/**
 * F080 / JT-V: the room screen — the part that turns three answers into one shell.
 *
 * It asks the destination for its space, asks each source for its projection (through the shared
 * client) and asks the Worker for the recap. Everything it renders is something it was given: no
 * screen here decides permissions, and a failed request becomes a state rather than an exception.
 */

export interface SpaceRoomDeps extends JoinedReadDeps {
  /** The room's own view: title plus the space it holds. */
  loadSpace(workspaceId: string): Promise<{ title: string; space: CollaborationSpace } | undefined>;
  /** The derived recap, already authorized by the Worker. */
  loadRecap(workspaceId: string): Promise<{
    headline: string;
    incomplete: boolean;
    changed: { workspaceId: string }[];
    withdrawn: { workspaceId: string }[];
    members?: { actorId: string; unseen: boolean }[];
  } | undefined>;
  /** Who is looking, for the header. */
  viewerLabel(actorId: string): string;
  actorId: string;
  /**
   * The connections each source says it holds for this room.
   *
   * The destination does not know a grant id or a port id — only the source does — so it asks. A
   * screen that invented them would be guessing at wording the source never agreed to.
   */
  loadConnections(workspaceId: string): Promise<{ workspaceId: string; grantId: string; ports: string[] }[]>;
}

export interface SpaceRoomScreenProps {
  workspaceId: string;
  deps: SpaceRoomDeps;
}

export function SpaceRoomScreen(props: SpaceRoomScreenProps): React.ReactElement {
  const [space, setSpace] = useState<{ title: string; space: CollaborationSpace } | undefined>();
  const [sources, setSources] = useState<JoinedSource[]>([]);
  const [recap, setRecap] = useState<RoomRecapView | undefined>();
  const [activeTableId, setActiveTableId] = useState('');
  const [note, setNote] = useState('กำลังอ่านข้อมูลจากต้นทาง');

  const load = useCallback(async (): Promise<void> => {
    const view = await props.deps.loadSpace(props.workspaceId);
    if (!view) {
      setNote('เปิดห้องนี้ไม่ได้ — คุณอาจไม่ได้เป็นสมาชิก');
      return;
    }
    setSpace(view);
    setActiveTableId(current => (current || view.space.sources[0]?.workspaceId || ''));

    const requests = [] as { workspaceId: string; label: string; portId: string; grantId: string }[];
    const connections = await props.deps.loadConnections(props.workspaceId);
    for (const connection of connections) {
      const source = view.space.sources.find(entry => entry.workspaceId === connection.workspaceId);
      if (!source || source.status !== 'linked') continue;
      for (const port of connection.ports) {
        requests.push({
          workspaceId: connection.workspaceId,
          label: connection.workspaceId.slice(0, 8),
          portId: port,
          grantId: connection.grantId,
        });
      }
    }
    if (requests.length === 0) {
      setSources([]);
      setNote('ห้องนี้ยังไม่มีช่องทางข้อมูลที่ต้นทางเปิดไว้');
    } else {
      const next = await readJoinedSources(props.workspaceId, requests, props.deps);
      setSources(next);
    }

    const summary = await props.deps.loadRecap(props.workspaceId);
    if (summary) {
      setRecap({
        headline: summary.headline,
        incomplete: summary.incomplete,
        changed: summary.changed.length,
        withdrawn: summary.withdrawn.length,
        unseen: summary.members?.find(member => member.actorId === props.deps.actorId)?.unseen ?? true,
      });
    }
    setNote('');
  }, [props.deps, props.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tables: RoomTableSummary[] = (space?.space.sources ?? []).map(source => ({
    workspaceId: source.workspaceId,
    // The room does not invent a title for a table it was not given one for.
    title: source.workspaceId.slice(0, 8),
    dataRevision: sources.find(entry => entry.workspaceId === source.workspaceId)?.dataRevision ?? 0,
    status: source.status === 'linked' ? 'linked' : 'left',
  }));

  return (
    <RoomShell
      title={space?.title ?? 'ห้อง'}
      viewerLabel={props.deps.viewerLabel(props.deps.actorId)}
      tables={tables}
      activeTableId={activeTableId}
      onSelectTable={setActiveTableId}
      joinedSources={sources}
      onRefreshData={load}
      onDisconnectSource={async () => { /* revoking belongs to the source; the shell only reports it */ }}
      recap={recap}
      tool={<p data-testid="space-room-note" style={{ margin: 0 }}>{note || 'เครื่องมือของห้องนี้ยังไม่ถูกเลือก'}</p>}
    />
  );
}
