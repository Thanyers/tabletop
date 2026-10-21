import { GENERATIVE_LIMITS, type GenerativeCanvas } from '../../shared/generative-contracts';
import type { TableProgram, TableRecord } from '../../shared/table-contracts';
import { validateGenerativeProgram } from './validation';

type Records = Record<string, TableRecord[]>;

/**
 * Carries canvas views the AI dropped while evolving rules (F018).
 * Views already present in the new program always win; a carried view is kept only when it
 * still validates against the new program (removed collections, actions or fields drop it).
 */
export function preserveCanvasViews(
  previous: GenerativeCanvas | undefined,
  next: GenerativeCanvas | undefined,
  program: TableProgram,
  records?: Records,
): GenerativeCanvas | undefined {
  const previousViews = previous?.views ?? [];
  if (previousViews.length === 0) return next;
  const kept = [...(next?.views ?? [])];
  if (kept.length >= GENERATIVE_LIMITS.canvasViews) return next;
  const seen = new Set(kept.map((view) => view.id));
  for (const view of previousViews) {
    if (seen.has(view.id)) continue;
    if (kept.length >= GENERATIVE_LIMITS.canvasViews) break;
    // Validate the growing set, so the manifest-node budget and unique ids stay correct.
    const trial: TableProgram = { ...program, canvas: { version: 1, views: [...kept, view] } };
    if (validateGenerativeProgram(trial, records).length > 0) continue;
    kept.push(view);
    seen.add(view.id);
  }
  if (kept.length === (next?.views.length ?? 0)) return next;
  return { version: 1, views: kept };
}
