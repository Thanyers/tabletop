// F067: shared pre-send table payload for the provider and UI meter; optional runtime capabilities
// are included in both. Server-only research enrichment is added after this payload is built.
import type { TableProgram, TableRecord } from './table-contracts';
import type { ComputeRuntimeCapabilities } from './compute-runtime-profiles';

/** Read by the model next to each omitted file, so the system prompt stays within its size budget. */
export const IMPORTED_SOURCE_NOTE = 'Already cited by the current program; text omitted to keep the request small, rows are in records. Keep evidence that cites it exactly as is; never write a new quote from it.';

export interface TableDraftSource { id: string; filename: string; text: string }
export interface TableDraftState {
  sources: readonly TableDraftSource[];
  program: TableProgram | null;
  records: Record<string, TableRecord[]>;
  turn: string | null;
  notes?: readonly { text: string; color: string }[];
}
export interface TableDraftInput {
  kind: 'table';
  prompt: string;
  sources: TableDraftSource[];
  importedSources?: { id: string; filename: string; note: string }[];
  program: TableProgram | null;
  records: Record<string, TableRecord[]>;
  turn: string | null;
  notes?: { text: string; color: string }[];
  computeCapabilities?: ComputeRuntimeCapabilities;
}

/**
 * Files the active rules already cite were imported earlier: their rows are in records and their quotes are
 * checked against the stored text, so only their names travel. A large table can keep growing this way.
 */
export function tableDraftInput(
  state: TableDraftState,
  prompt: string,
  computeCapabilities?: ComputeRuntimeCapabilities,
): TableDraftInput {
  const cited = new Set((state.program?.evidence ?? []).map((item) => item.sourceId));
  const imported = state.sources.filter((source) => cited.has(source.id));
  return {
    kind: 'table',
    prompt,
    sources: state.sources.filter((source) => !cited.has(source.id)).map(({ id, filename, text }) => ({ id, filename, text })),
    ...(imported.length ? { importedSources: imported.map(({ id, filename }) => ({ id, filename, note: IMPORTED_SOURCE_NOTE })) } : {}),
    program: structuredClone(state.program),
    records: structuredClone(state.records),
    turn: state.turn,
    ...(state.notes?.length ? { notes: state.notes.map(({ text, color }) => ({ text, color })) } : {}),
    ...(computeCapabilities ? { computeCapabilities: structuredClone(computeCapabilities) } : {}),
  };
}

/** Bytes the request carries for this table and message, measured like the provider does (UTF-8 JSON). */
export function tableDraftBytes(
  state: TableDraftState,
  prompt = '',
  computeCapabilities?: ComputeRuntimeCapabilities,
): number {
  return new TextEncoder().encode(JSON.stringify(tableDraftInput(state, prompt, computeCapabilities))).byteLength;
}
