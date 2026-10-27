import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CollaborationSpace } from '../shared/collaboration-space';
import type { ToolIntentOutcome, ToolScalar } from '../shared/tool-protocol';
import type { JoinedSource } from './JoinedProjectionView';
import type { JoinedReadDeps } from './joined-projection-client';
import { readJoinedSources } from './joined-projection-client';
import { GeneratedToolHost, type ToolIntentRequest } from './GeneratedToolHost';
import { compileRoomTool, toolInstanceId, toolNonce, toolPortSnapshots, toolPresentation } from './room-tool-hosting';
import { RoomShell, type RoomRecapView, type RoomTableSummary } from './RoomShell';
import { ToolInstallationCard } from './ToolInstallationCard';
import { ToolInstallPanel } from './ToolInstallPanel';
import { RoomSourcesPanel, type LinkedSource } from './RoomSourcesPanel';
import type { SourceCandidate } from './RoomSourcesPanel';
import type { ToolInstallTool } from './tool-install-input';

/**
 * F080 / JT-V: the room screen — the part that turns three answers into one shell.
 *
 * It asks the destination for its space, asks each source for its projection (through the shared
 * client) and asks the Worker for the recap. Everything it renders is something it was given: no
 * screen here decides permissions, and a failed request becomes a state rather than an exception.
 *
 * D-040: when the room holds an installed package with a definition, the tool slot mounts the real
 * `GeneratedToolHost` compiled from that package. The screen never writes: a behaviour the frame asks
 * for goes through `runToolIntent`, which is the Worker route that commits through `table.act`.
 */

/** What the room answers when a frame asks it to run a declared behaviour. */
export type ToolIntentAnswer =
  | { ok: true; actionId: string; ack: unknown }
  | { ok: false; code: string; message: string };

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
  /** F080 / D-044: origin that serves the sandbox document; absent keeps the srcdoc path. */
  toolSandboxOrigin?: string;
  /**
   * The connections each source says it holds for this room.
   *
   * The destination does not know a grant id or a port id — only the source does — so it asks. A
   * screen that invented them would be guessing at wording the source never agreed to.
   */
  loadConnections(workspaceId: string): Promise<{ workspaceId: string; grantId: string; ports: string[] }[]>;
  /**
   * Runs one declared behaviour of the room's installed tool.
   *
   * A refusal is a value, not an exception (D-040): the frame gets the code so the package can branch
   * on it, and the screen can say why nothing was committed.
   */
  /** D-053: tables the viewer could link here; absent when the caller does not know them. */
  sourceCandidates?: SourceCandidate[];
  linkSource?(workspaceId: string): Promise<{ ok: boolean; message: string }>;
  unlinkSource?(workspaceId: string): Promise<{ ok: boolean; message: string }>;
  /** D-051: install a package in this room; absent when the caller may not author. */
  installTool?(tool: ToolInstallTool): Promise<{ ok: boolean; message: string }>;
  runToolIntent(input: {
    behaviorId: string;
    inputs: Record<string, string | number | boolean>;
  }): Promise<ToolIntentAnswer>;
}

export interface SpaceRoomScreenProps {
  workspaceId: string;
  deps: SpaceRoomDeps;
}

/** The route's input contract has no `null`: an absent input is one the frame did not send (D-038). */
export function intentInputs(inputs: Record<string, ToolScalar>): Record<string, string | number | boolean> {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    next[key] = value;
  }
  return next;
}

/** The page's own presentation signals, so a package renders in the room's language and motion. */
function roomToolView(): { locale: 'th' | 'en'; reducedMotion: boolean } {
  const language = document.documentElement.lang.toLowerCase();
  return {
    locale: language.startsWith('th') ? 'th' : 'en',
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

export function SpaceRoomScreen(props: SpaceRoomScreenProps): React.ReactElement {
  const [space, setSpace] = useState<{ title: string; space: CollaborationSpace } | undefined>();
  const [sources, setSources] = useState<JoinedSource[]>([]);
  const [recap, setRecap] = useState<RoomRecapView | undefined>();
  const [activeTableId, setActiveTableId] = useState('');
  const [note, setNote] = useState('กำลังอ่านข้อมูลจากต้นทาง');
  const [intentNote, setIntentNote] = useState('');

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

  const tool = space?.space.tool;
  const definition = tool?.definition;

  /**
   * Keyed on what installing a different version changes, not on object identity: a re-read of the room
   * replaces every object it returns, and remounting the frame for that would throw away the package's
   * own UI state on every committed intent.
   */
  const compiled = useMemo(
    () => compileRoomTool(tool),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the installed identity on purpose
    [tool?.packageId, tool?.version, tool?.contentHash],
  );
  const ports = useMemo(() => toolPortSnapshots(sources, definition), [sources, definition]);
  const presentation = useMemo(
    () => toolPresentation(definition, roomToolView()),
    [definition],
  );
  const nonce = useMemo(
    () => toolNonce(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new install is a new instance
    [tool?.contentHash],
  );

  const onIntent = useCallback(async (request: ToolIntentRequest): Promise<ToolIntentOutcome> => {
    const answer = await props.deps.runToolIntent({
      behaviorId: request.behaviorId,
      inputs: intentInputs(request.inputs),
    });
    if (!answer.ok) {
      setIntentNote(answer.code);
      return {
        requestId: request.requestId,
        behaviorId: request.behaviorId,
        status: 'rejected',
        code: answer.code,
        message: answer.message,
      };
    }
    setIntentNote('');
    // The route already committed through the room's action path; re-read so the change is visible.
    await load();
    return { requestId: request.requestId, behaviorId: request.behaviorId, status: 'committed' };
  }, [props.deps, load]);

  const tables: RoomTableSummary[] = (space?.space.sources ?? []).map(source => ({
    workspaceId: source.workspaceId,
    // The room does not invent a title for a table it was not given one for.
    title: source.workspaceId.slice(0, 8),
    dataRevision: sources.find(entry => entry.workspaceId === source.workspaceId)?.dataRevision ?? 0,
    status: source.status === 'linked' ? 'linked' : 'left',
  }));

  let toolSlot: React.ReactNode;
  if (!tool) {
    toolSlot = props.deps.installTool ? (
      <ToolInstallPanel installTool={props.deps.installTool} onInstalled={() => { void load(); }} />
    ) : (
      <p data-testid="space-room-note" style={{ margin: 0 }}>{note || 'เครื่องมือของห้องนี้ยังไม่ถูกเลือก'}</p>
    );
  } else if (compiled.state === 'ready') {
    toolSlot = (
      <div className="tt-room__tool-host">
        <GeneratedToolHost
          instanceId={toolInstanceId(tool)}
          nonce={nonce}
          compiled={compiled.compiled}
          ports={ports}
          presentation={presentation}
          onIntent={onIntent}
          title={tool.title}
          {...(props.deps.toolSandboxOrigin ? { sandboxOrigin: props.deps.toolSandboxOrigin } : {})}
        />
        {intentNote ? <p className="tt-room__tool-note" role="status" data-testid="room-tool-intent">{intentNote}</p> : null}
      </div>
    );
  } else {
    // A package that cannot compile is still an installed tool: say which, and say what went wrong.
    toolSlot = (
      <>
        <ToolInstallationCard tool={tool} />
        {compiled.state === 'failed' ? (
          <p className="tt-room__tool-note" role="status" data-testid="room-tool-problem">
            {compiled.problems.map(problem => `${problem.path}: ${problem.message}`).join(' · ')}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <RoomShell
      title={space?.title ?? 'ห้อง'}
      viewerLabel={props.deps.viewerLabel(props.deps.actorId)}
      tables={tables}
      activeTableId={activeTableId}
      onSelectTable={setActiveTableId}
      joinedSources={sources}
      sources={props.deps.linkSource ? (
        <RoomSourcesPanel
          roomId={props.workspaceId}
          candidates={props.deps.sourceCandidates ?? []}
          linked={sources.map((source): LinkedSource => ({
            workspaceId: source.workspaceId,
            title: source.label,
            status: source.status === 'revoked' || source.status === 'missing' ? 'revoked' : 'linked',
          }))}
          linkSource={props.deps.linkSource}
          unlinkSource={props.deps.unlinkSource ?? (async () => ({ ok: false, message: 'ถอดโต๊ะไม่ได้ในบริบทนี้' }))}
        />
      ) : undefined}

      onRefreshData={load}
      onDisconnectSource={async () => { /* revoking belongs to the source; the shell only reports it */ }}
      recap={recap}
      tool={toolSlot}
    />
  );
}
