import type { WorkspaceView } from '../shared/contracts';

export const DEFAULT_CANVAS_AUXILIARY_IDS = {
  people: 'workspace.people',
  history: 'workspace.history',
  ai: 'workspace.ai',
  teachingRules: 'lesson.rules',
} as const;

export function defaultCanvasAuxiliaryObjectIds(kind?: WorkspaceView['kind']): string[] {
  const shared = [DEFAULT_CANVAS_AUXILIARY_IDS.people, DEFAULT_CANVAS_AUXILIARY_IDS.history, DEFAULT_CANVAS_AUXILIARY_IDS.ai];
  return kind === 'teaching' ? [...shared, DEFAULT_CANVAS_AUXILIARY_IDS.teachingRules] : shared;
}
