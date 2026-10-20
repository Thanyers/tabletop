import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AlertCircle, MessageCircle } from 'lucide-react';
import { CanvasWorkspace, type CanvasAuxiliaryObject } from './CanvasWorkspace';
import { EncounterWorkbench } from './EncounterWorkbench';
import { InvoiceWorkbench } from './InvoiceWorkbench';
import { TeachingWorkbench } from './TeachingWorkbench';
import { MemberStrip } from './WorkbenchShared';
import { createCanvasAuxiliaryObjects } from './CanvasAuxiliaryObjects';
import type { ExecutablePlan, WorkbenchProps } from './types';

export interface TableSurfaceProps extends Omit<WorkbenchProps, 'plan'> {
  plan: ExecutablePlan | null;
  planError: string | null;
  surface: 'canvas' | 'focus';
  editMode?: 'use' | 'arrange';
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  inspectorContent?: ReactNode;
  inspectorScrollRef?: RefObject<HTMLDivElement | null>;
  onReload?: () => void;
  persistLayout?: boolean;
  preparedDemoArt?: boolean;
  visibleNodeIds?: readonly string[];
  focusNodeId?: string | null;
  focusRequestKey?: string | number;
  auxiliaryObjects?: readonly CanvasAuxiliaryObject[];
  emptyContent?: ReactNode;
  openedObjectId?: string | null;
  onOpenObject?: (id: string | null) => void;
  onInvite?: () => void;
  aiContent?: ReactNode;
  assistantContent?: ReactNode;
  promptContent?: ReactNode;
  onFocusObject?: (id: string) => void;
}

export function TableSurface({
  view,
  plan,
  planError,
  surface,
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
  preparedDemoArt,
  visibleNodeIds,
  focusNodeId,
  focusRequestKey,
  auxiliaryObjects,
  emptyContent,
  openedObjectId,
  onOpenObject,
  onInvite,
  aiContent,
  assistantContent,
  promptContent,
  onFocusObject,
}: TableSurfaceProps) {
  const [dropError, setDropError] = useState('');
  const [dropping, setDropping] = useState(false);
  const [assistantHeight, setAssistantHeight] = useState(300);
  const assistantPanelRef = useRef<HTMLElement>(null);
  const hasAssistant = Boolean(assistantContent);
  useEffect(() => {
    if (!hasAssistant || !assistantPanelRef.current) return;
    const panel = assistantPanelRef.current;
    const observer = new ResizeObserver(() => setAssistantHeight(Math.ceil(panel.getBoundingClientRect().height)));
    observer.observe(panel);
    return () => observer.disconnect();
  }, [hasAssistant]);
  const focusCanvasObject = useMemo(() => onFocusObject ?? (onOpenObject ? (id: string) => { onSelectNode(id); onOpenObject(id); } : undefined), [onFocusObject, onOpenObject, onSelectNode]);
  const mergedAuxiliaryObjects = useMemo(() => {
    const merged = new Map(createCanvasAuxiliaryObjects({ view, onCommand, busy, onInvite, aiContent, onFocusObject: focusCanvasObject }).map((object) => [object.id, object]));
    for (const object of auxiliaryObjects ?? []) merged.set(object.id, object);
    if (assistantContent) merged.set('workspace.ai', {
      id: 'workspace.ai', title: 'Assistant',
      content: <div className="tt-canvas-inline"><p>Questions, ideas and rule drafts for this table.</p><button type="button" className="tt-button tt-button--quiet" onClick={() => { const input = document.getElementById('tt-table-chat-prompt') ?? document.getElementById('tt-ai-prompt'); input?.focus(); }}><MessageCircle size={15} />Write a message</button></div>,
    });
    return [...merged.values()];
  }, [view, onCommand, busy, onInvite, aiContent, assistantContent, focusCanvasObject, auxiliaryObjects]);
  const layoutSurface = view.kind === 'table' && assistantContent ? 'canvas' : surface;

  return (
    <main className={`tt-main tt-main--${layoutSurface}${view.kind === 'table' && assistantContent ? ' tt-main--with-assistant' : ''}`}>
      <section className={`tt-canvas-panel${promptContent ? ' tt-canvas-panel--composer' : ''}${assistantContent ? ' tt-canvas-panel--assistant' : ''}`} style={hasAssistant ? { '--tt-assistant-height': `${assistantHeight}px` } as CSSProperties : undefined} aria-label="Table objects canvas"
        onDragOver={(event) => { if (view.kind === 'table' && onTableImport && view.actor.role === 'owner' && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
        onDrop={(event) => {
          if (view.kind !== 'table' || !onTableImport || view.actor.role !== 'owner' || !event.dataTransfer.files.length) return;
          event.preventDefault(); event.stopPropagation();
          if (busy || dropping) return;
          const files = Array.from(event.dataTransfer.files);
          setDropping(true); setDropError('');
          void (async () => { let current = view; for (const file of files) current = await onTableImport(current, file); })()
            .catch((error: unknown) => setDropError(error instanceof Error ? error.message : 'This file could not be added.'))
            .finally(() => setDropping(false));
        }}>
        {dropError && <p role="alert" className="tt-canvas-file-status">{dropError}</p>}
        {dropping && <p role="status" className="tt-canvas-file-status">Adding files…</p>}
        {plan ? (
          <CanvasWorkspace
            view={view}
            plan={plan}
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
            preparedDemoArt={preparedDemoArt}
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
        {promptContent}
        {assistantContent && <aside ref={assistantPanelRef} className="tt-table-assistant-panel" data-testid="table-assistant-panel" aria-label="Table assistant">
          {assistantContent}
        </aside>}
      </section>

      {surface === 'focus' && view.kind !== 'table' && <section className="tt-inspector-panel" aria-label="Table workbench">
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
