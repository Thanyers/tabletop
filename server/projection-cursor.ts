import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { hashValue } from './codec.js';

/** Transport changes include geometry; mutation revisions deliberately exclude it. */
export function projectionCursor(view: WorkspaceView): string {
  return view.domain.kind === 'table' && view.domain.canvasLayout
    ? hashValue({ revision: view.revision, layoutRevision: view.domain.canvasLayout.revision })
    : view.revision;
}
