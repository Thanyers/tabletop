import type { ReactNode, RefObject } from 'react';
import { AlertCircle } from 'lucide-react';
import type { CaseKind } from '../shared/contracts';
import { CanvasWorkspace } from './CanvasWorkspace';
import { EncounterWorkbench } from './EncounterWorkbench';
import { InvoiceWorkbench } from './InvoiceWorkbench';
import { TeachingWorkbench } from './TeachingWorkbench';
import { MemberStrip } from './WorkbenchShared';
import type { ExecutablePlan, WorkbenchProps } from './types';

const tableTitles: Record<CaseKind, string> = {
  invoice: 'Invoice check',
  teaching: 'Physics lesson',
  encounter: 'Shared encounter',
};

export interface TableSurfaceProps extends Omit<WorkbenchProps, 'plan'> {
  plan: ExecutablePlan | null;
  planError: string | null;
  surface: 'canvas' | 'focus';
  editMode: 'use' | 'arrange';
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  inspectorContent?: ReactNode;
  inspectorScrollRef?: RefObject<HTMLDivElement | null>;
  onReload?: () => void;
}

export function TableSurface({
  view,
  plan,
  planError,
  surface,
  editMode,
  selectedNodeId,
  onSelectNode,
  onCommand,
  busy,
  onUpload,
  onExport,
  onFocusEvidence,
  onBackFromEvidence,
  focusSourceIds,
  inspectorContent,
  inspectorScrollRef,
  onReload,
}: TableSurfaceProps) {
  const objectCount = plan?.nodes.length ?? 0;

  return (
    <main className={`tt-main tt-main--${surface}`}>
      <section className="tt-canvas-panel" aria-label="Table objects canvas">
        <div className="tt-canvas-panel__head">
          <div><span className="tt-kicker">TABLE WORK AREA</span><strong>{tableTitles[view.kind]}</strong></div>
          <span>{objectCount} {objectCount === 1 ? 'working object' : 'working objects'}</span>
        </div>
        {plan ? (
          <CanvasWorkspace
            view={view}
            plan={plan}
            mode={editMode}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onCommand={onCommand}
            busy={busy}
            onUpload={onUpload}
            onFocusEvidence={onFocusEvidence}
            focusSourceIds={focusSourceIds}
          />
        ) : (
          <div className="tt-plan-error" role="alert">
            <AlertCircle size={18} />
            <strong>This table needs a refresh</strong>
            <p>{planError ?? 'The current table could not be prepared.'}</p>
            {onReload && <button className="tt-button tt-button--quiet" type="button" onClick={onReload}>Reload table</button>}
          </div>
        )}
      </section>

      <section className="tt-inspector-panel" aria-label="Table workbench">
        <div className="tt-inspector-scroll" ref={inspectorScrollRef}>
          <MemberStrip view={view} />
          {inspectorContent}
          {planError && <div className="tt-inline-plan-warning" role="alert"><AlertCircle size={15} /><span>{planError}</span></div>}
          {plan && view.kind === 'invoice' && <InvoiceWorkbench view={view} plan={plan} onCommand={onCommand} busy={busy} onUpload={onUpload} onExport={onExport} onFocusEvidence={onFocusEvidence} onBackFromEvidence={onBackFromEvidence} focusSourceIds={focusSourceIds} />}
          {plan && view.kind === 'teaching' && <TeachingWorkbench view={view} plan={plan} onCommand={onCommand} busy={busy} onUpload={onUpload} onExport={onExport} onFocusEvidence={onFocusEvidence} onBackFromEvidence={onBackFromEvidence} focusSourceIds={focusSourceIds} />}
          {plan && view.kind === 'encounter' && <EncounterWorkbench view={view} plan={plan} onCommand={onCommand} busy={busy} onUpload={onUpload} onExport={onExport} onFocusEvidence={onFocusEvidence} onBackFromEvidence={onBackFromEvidence} focusSourceIds={focusSourceIds} />}
        </div>
      </section>
    </main>
  );
}
