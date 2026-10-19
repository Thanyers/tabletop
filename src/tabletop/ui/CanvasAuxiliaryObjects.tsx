import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { WorkspaceView } from '../shared/contracts';
import type { CanvasAuxiliaryObject } from './CanvasWorkspace';
import { DEFAULT_CANVAS_AUXILIARY_IDS } from './CanvasObjectIds';
import { CandidateLifecycle, MemberStrip } from './WorkbenchShared';
import type { Command } from './types';
import { formatMoney } from './types';

export interface CanvasAuxiliaryObjectOptions {
  view: WorkspaceView;
  onCommand: Command;
  busy: string | null;
  onInvite?: () => void;
  aiContent?: ReactNode;
  onFocusObject?: (id: string) => void;
}

/** Build shared, projection-safe table containers; callers may replace any object by id. */
export function createCanvasAuxiliaryObjects({ view, onCommand, busy, onInvite, aiContent, onFocusObject }: CanvasAuxiliaryObjectOptions): CanvasAuxiliaryObject[] {
  const objects: CanvasAuxiliaryObject[] = [
    {
      id: DEFAULT_CANVAS_AUXILIARY_IDS.people,
      title: 'People at this table',
      eyebrow: 'MEMBERS',
      content: <div className="tt-canvas-inline">
        <div className="tt-canvas-inline__heading"><span className="tt-kicker">SHARED TABLE</span><strong>{view.members.length} {view.members.length === 1 ? 'person' : 'people'}</strong><small>Current access</small></div>
        <MemberStrip view={view} />
        {onInvite ? <button type="button" className="tt-button tt-button--quiet" onClick={onInvite}><Plus size={13} /> Invite someone</button> : <p className="tt-canvas-inline__note">People and roles shown here follow this table’s access.</p>}
      </div>,
    },
    {
      id: DEFAULT_CANVAS_AUXILIARY_IDS.history,
      title: 'Table history',
      eyebrow: 'RECENT ACTIVITY',
      renderContent: (expanded) => <CanvasHistoryContainer view={view} expanded={expanded} />,
    },
  ];
  if (aiContent) objects.push({
    id: DEFAULT_CANVAS_AUXILIARY_IDS.ai,
    title: 'AI draft assistant',
    eyebrow: 'OPTIONAL ASSISTANCE',
    content: aiContent,
  });
  if (view.kind === 'teaching') objects.push({
    id: DEFAULT_CANVAS_AUXILIARY_IDS.teachingRules,
    title: 'Lesson rules and lifecycle',
    eyebrow: 'CHANGE CONTROL',
    content: view.domain.kind === 'teaching' ? <div className="tt-canvas-inline">
      <div className="tt-canvas-inline__heading"><span className="tt-kicker">SHARED LESSON · REVISION {view.domain.ruleRevision}</span><strong>Force, mass, and motion rules</strong><small>Current shared parameters</small></div>
      <div className="tt-lesson-rule-values"><span><small>Force</small><strong>{view.domain.parameters.force} N</strong></span><span><small>Mass</small><strong>{view.domain.parameters.mass} kg</strong></span><span><small>Time</small><strong>{view.domain.parameters.time} s</strong></span></div>
      <div className="tt-model-text"><code>a = F ÷ m</code><code>v = a × t</code><code>x = ½at²</code></div>
      {view.actor.role === 'teacher' ? <>
        <p className="tt-canvas-inline__note">Adjust the shared values in the lesson source. A proposal stays separate until its lifecycle is completed.</p>
        <button type="button" className="tt-button tt-button--quiet" onClick={() => onFocusObject?.('lesson.source')} disabled={!onFocusObject}>Open force and mass controls</button>
        <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />
      </> : <p className="tt-canvas-inline__note">These are the teacher’s shared values. Your private experiment stays in the lesson source container.</p>}
    </div> : null,
  });
  return objects;
}

function CanvasHistoryContainer({ view, expanded }: { view: WorkspaceView; expanded: boolean }) {
  const entries = view.domain.kind === 'invoice'
    ? [...view.domain.runs].reverse().map((run) => ({ id: run.id, title: `Saved run · rules r${run.ruleRevision} · data r${run.dataRevision}`, detail: `${run.result.rows.length} rows · ${run.result.unknownCount} unknown · difference ${formatMoney(run.result.deltaSatang)}`, at: run.createdAt }))
    : view.domain.kind === 'teaching'
      ? [...view.domain.answers].reverse().map((answer) => ({ id: `${answer.actorId}-${answer.questionId}-${answer.submittedAt}`, title: `${answer.name} · ${answer.correct ? 'correct' : 'needs another try'}`, detail: `Lesson r${answer.lessonRevision} · ${answer.value} m`, at: answer.submittedAt }))
      : [...view.domain.events].reverse().map((event) => ({ id: event.id, title: event.text, detail: new Date(event.createdAt).toLocaleString(), at: event.createdAt }));
  const revisions = [...view.domain.revisions].reverse();
  const visibleEntries = expanded ? entries : entries.slice(0, 3);
  const visibleRevisions = expanded ? revisions : revisions.slice(0, 3);
  return <div className="tt-canvas-inline">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">RECENT ACTIVITY</span><strong>{entries.length + revisions.length} recorded items</strong><small>{expanded ? 'Complete history for this table view' : `Latest ${visibleEntries.length + visibleRevisions.length} entries · open for all`}</small></div>
    {entries.length === 0 && revisions.length === 0 ? <div className="tt-canvas-inline__empty">Saved runs, answers, turns, and activated rule changes will appear here.</div> : <>
      {visibleEntries.length > 0 && <section className="tt-inline-history" aria-label="Recent table activity"><header><strong>{view.kind === 'invoice' ? 'Saved runs' : view.kind === 'teaching' ? 'Lesson responses' : 'Encounter events'}</strong><span>{entries.length}</span></header><ol>{visibleEntries.map((entry) => <li key={entry.id}><span><strong>{entry.title}</strong><small>{entry.detail}</small></span><time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol></section>}
      {visibleRevisions.length > 0 && <section className="tt-inline-history" aria-label="Activated revisions"><header><strong>Activated rule changes</strong><span>{view.domain.ruleRevision}</span></header><ol>{visibleRevisions.map((record) => <li key={record.revision}><span><strong>Revision {record.revision} · {revisionDescription(record.change)}</strong><small>{view.members.find((member) => member.actorId === record.actorId)?.name ?? 'Table member'} · {new Date(record.activatedAt).toLocaleString()}</small></span></li>)}</ol></section>}
    </>}
  </div>;
}

function revisionDescription(change: WorkspaceView['domain']['revisions'][number]['change']): string {
  if (change.kind === 'invoice') return `${change.operations.length} dated rate ${change.operations.length === 1 ? 'change' : 'changes'}`;
  if (change.kind === 'teaching') return `Force ${change.parameters.force} N · mass ${change.parameters.mass} kg · time ${change.parameters.time} s`;
  return `${change.rule.allyTarget ? 'Self or ally' : 'Self only'} · ${change.rule.apCost} AP shield`;
}
