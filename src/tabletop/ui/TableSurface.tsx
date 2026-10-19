import { useMemo, type ReactNode, type RefObject } from 'react';
import { AlertCircle } from 'lucide-react';
import type { CaseKind } from '../shared/contracts';
import { CanvasWorkspace, type CanvasAuxiliaryObject } from './CanvasWorkspace';
import { EncounterWorkbench } from './EncounterWorkbench';
import { InvoiceWorkbench } from './InvoiceWorkbench';
import { TeachingWorkbench } from './TeachingWorkbench';
import { MemberStrip } from './WorkbenchShared';
import { createCanvasAuxiliaryObjects } from './CanvasAuxiliaryObjects';
import type { ExecutablePlan, WorkbenchProps } from './types';

const tableTitles: Record<CaseKind, string> = {
  invoice: 'Invoice check',
  teaching: 'Physics lesson',
  encounter: 'Shared encounter',
  table: 'Shared data table',
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
  persistLayout?: boolean;
  visibleNodeIds?: readonly string[];
  focusNodeId?: string | null;
  focusRequestKey?: string | number;
  auxiliaryObjects?: readonly CanvasAuxiliaryObject[];
  emptyContent?: ReactNode;
  openedObjectId?: string | null;
  onOpenObject?: (id: string | null) => void;
  onInvite?: () => void;
  aiContent?: ReactNode;
  onFocusObject?: (id: string) => void;
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
  onTableImport,
  onExport,
  onFocusEvidence,
  onBackFromEvidence,
  focusSourceIds,
  inspectorContent,
  inspectorScrollRef,
  onReload,
  persistLayout,
  visibleNodeIds,
  focusNodeId,
  focusRequestKey,
  auxiliaryObjects,
  emptyContent,
  openedObjectId,
  onOpenObject,
  onInvite,
  aiContent,
  onFocusObject,
}: TableSurfaceProps) {
  const focusCanvasObject = useMemo(() => onFocusObject ?? (onOpenObject ? (id: string) => { onSelectNode(id); onOpenObject(id); } : undefined), [onFocusObject, onOpenObject, onSelectNode]);
  const mergedAuxiliaryObjects = useMemo(() => {
    const merged = new Map(createCanvasAuxiliaryObjects({ view, onCommand, busy, onInvite, aiContent, onFocusObject: focusCanvasObject }).map((object) => [object.id, object]));
    for (const object of auxiliaryObjects ?? []) merged.set(object.id, object);
    return [...merged.values()];
  }, [view, onCommand, busy, onInvite, aiContent, focusCanvasObject, auxiliaryObjects]);
  const planIds = new Set(plan?.nodes.map((node) => node.id) ?? []);
  const visiblePlanCount = plan?.nodes.filter((node) => node.visible !== false && (!visibleNodeIds || visibleNodeIds.includes(node.id))).length ?? 0;
  const visibleAuxiliaryCount = plan ? mergedAuxiliaryObjects.filter((object) => !planIds.has(object.id) && (!visibleNodeIds || visibleNodeIds.includes(object.id))).length : 0;
  const objectCount = visiblePlanCount + visibleAuxiliaryCount;

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
            onTableImport={onTableImport}
            onExport={onExport}
            onFocusEvidence={onFocusEvidence}
            focusSourceIds={focusSourceIds}
            persistLayout={persistLayout}
            visibleNodeIds={visibleNodeIds}
            focusNodeId={focusNodeId}
            focusRequestKey={focusRequestKey}
            auxiliaryObjects={mergedAuxiliaryObjects}
            emptyContent={emptyContent}
            openedObjectId={openedObjectId}
            onOpenObject={onOpenObject}
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

      {surface === 'focus' && <section className="tt-inspector-panel" aria-label="Table workbench">
        <div className="tt-inspector-scroll" ref={inspectorScrollRef}>
          <MemberStrip view={view} />
          {inspectorContent}
          {planError && <div className="tt-inline-plan-warning" role="alert"><AlertCircle size={15} /><span>{planError}</span></div>}
          {plan && view.kind === 'invoice' && <InvoiceWorkbench view={view} plan={plan} onCommand={onCommand} busy={busy} onUpload={onUpload} onExport={onExport} onFocusEvidence={onFocusEvidence} onBackFromEvidence={onBackFromEvidence} focusSourceIds={focusSourceIds} />}
          {plan && view.kind === 'teaching' && <TeachingWorkbench view={view} plan={plan} onCommand={onCommand} busy={busy} onUpload={onUpload} onExport={onExport} onFocusEvidence={onFocusEvidence} onBackFromEvidence={onBackFromEvidence} focusSourceIds={focusSourceIds} />}
          {plan && view.kind === 'encounter' && <EncounterWorkbench view={view} plan={plan} onCommand={onCommand} busy={busy} onUpload={onUpload} onExport={onExport} onFocusEvidence={onFocusEvidence} onBackFromEvidence={onBackFromEvidence} focusSourceIds={focusSourceIds} />}
        </div>
      </section>}
    </main>
  );
}
