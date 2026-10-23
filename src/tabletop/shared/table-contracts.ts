import type { TableDataProvenance } from './table-data-provenance';
import type { DomainBase } from './contracts';
import type { GenerativeCanvas, GenerativeExpression } from './generative-contracts';
import type { RollSpec, TablePendingRoll } from './roll';
import type { ComputeRunRecord, TableComputeProgram } from './table-compute';

/** Data-only program with a bounded arithmetic AST and optional closed canvas descriptors. */
export type TableValue = string | number | boolean | null | string[];
export interface TableField { id: string; label: string; type: 'text' | 'number' | 'boolean' | 'list'; required: boolean; min?: number; max?: number; choices?: string[]; default?: TableValue }
export interface TableCollection { id: string; title: string; fields: TableField[] }
export interface TableRecord { id: string; values: Record<string, TableValue> }
export interface TableSource { id: string; filename: string; text: string; sha256: string; createdAt: number }
/** F048: a `roll` parameter is filled by the authority, never by the client. It behaves as a number. */
export interface TableParameter { id: string; label: string; type: 'text' | 'number' | 'boolean' | 'record' | 'roll'; collection?: string; min?: number; max?: number; choices?: string[]; roll?: RollSpec }
export type TableOperand = { literal: TableValue } | { input: string } | { record: string; field: string } | { system: 'actor' | 'seat' | 'turn' } | { expression: GenerativeExpression };
export interface TableCondition { left: TableOperand; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; right: TableOperand; message: string }
export interface TableEffect { record: string; field: string; op: 'set' | 'add'; value: TableOperand }
export interface TableCreate { collection: string; values: Record<string, TableOperand> }
export interface TableAction { id: string; title: string; description: string; roles: ('owner' | 'participant')[]; parameters: TableParameter[]; conditions: TableCondition[]; effects: TableEffect[]; creates?: TableCreate[]; requireTurn: boolean; advanceTurn: boolean }
export interface TableInvariant { id: string; collection: string; fields: string[]; message: string }
export interface TableProgram {
  version: 1; title: string; description: string; collections: TableCollection[]; actions: TableAction[];
  /** Composite unique constraints checked after every action, atomically. */
  invariants: TableInvariant[]; turnOrder: string[];
  evidence: { sourceId: string; quote: string }[]; assumptions: string[];
  /** Optional same-row derived fields. Definitions live in the rules; results remain projection-only. */
  computedColumns?: ComputedColumn[];
  /** Optional local canvas descriptions; omitted by existing version 1 programs. */
  canvas?: GenerativeCanvas;
  /** F066: reusable server-executed modules, versioned with the table rules. */
  compute?: TableComputeProgram;
}
export interface TableChange { kind: 'table'; program: TableProgram; initialRecords: Record<string, TableRecord[]> }
/** Row-relative bounded arithmetic over stored fields (F017). */
export type ComputedComparison = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
export type ComputedExpression =
  | { op: 'field'; field: string }
  | { op: 'literal'; value: number }
  | { op: 'text'; value: string }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: ComputedExpression; right: ComputedExpression }
  | { op: 'min' | 'max'; left: ComputedExpression; right: ComputedExpression }
  | { op: 'negate' | 'ceil' | 'floor' | 'abs'; value: ComputedExpression }
  | { op: 'round'; value: ComputedExpression; digits: number }
  | { op: 'compare'; compare: ComputedComparison; left: ComputedExpression; right: ComputedExpression }
  | { op: 'if'; condition: ComputedExpression; then: ComputedExpression; else: ComputedExpression }
  | { op: 'and' | 'or'; left: ComputedExpression; right: ComputedExpression };
export interface ComputedColumn { id: string; collection: string; label: string; expression: ComputedExpression }
/** F037: a shared canvas note. Kept out of the program so it survives rule edits and stays a plain note. */
export type NoteColor = 'yellow' | 'rose' | 'sky' | 'mint' | 'lavender' | 'sand';
export interface TableNote {
  id: string; text: string; color: NoteColor; x: number; y: number; width: number; height: number; createdBy: string; createdAt: number; updatedAt: number;
  /** F073: an image card shows this uploaded picture, with `text` as its caption. */
  imageId?: string;
}
/** F054: who a canvas card came from. `ai` means an AI-drafted program applied by a person, not "the AI wrote this alone". */
export type CanvasCardOrigin = 'ai' | 'human' | 'system' | 'demo';
/**
 * F054: when a canvas card was created and last changed, and who did it.
 * Kept outside `TableProgram` so it never enters the candidate hash or the 64 KiB program budget.
 * `actorId` is stored, never a display name, so the UI resolves names from the current members.
 */
export interface CanvasCardMeta {
  createdAt: number; updatedAt: number;
  createdBy?: string; updatedBy?: string;
  origin: CanvasCardOrigin; revision?: number;
  source: 'recorded' | 'inferred';
}
export interface TableState extends DomainBase {
  dataProvenance?: TableDataProvenance;
  kind: 'table'; sources: TableSource[]; program: TableProgram | null;
  records: Record<string, TableRecord[]>; turn: string | null;
  canvasLayout?: {
    revision: number;
    positions: Record<string, { x: number; y: number; pinned?: boolean }>;
    /** Soft-deleted cards: gone from everyone's canvas, listed under Deleted in Objects until restored. Oldest first. */
    trashed?: Record<string, { by: string; at: number }>;
    /** Card names set at this table; they replace the card's own title on every member's canvas. */
    titles?: Record<string, string>;
  };
  /**
   * Computed-column definitions projected for display. Persisted state keeps only legacy/manual definitions here;
   * projections merge them with canonical rule-owned definitions from program.computedColumns.
   */
  computedColumns?: ComputedColumn[];
  /**
   * F055: values computed by the server authority for every computed column, keyed
   * collection → record → column. Written only into a member's projection; never persisted
   * to the room, so every reader sees the same numbers and data changes recompute them.
   * `revision` stamps the dataRevision it was computed from, so a client-side preview can
   * tell that the numbers no longer match the state it is showing.
   */
  /** F066: bounded run lineage and results persist with the room for reconnect/resume. */
  computeRuns?: ComputeRunRecord[];
  computedValues?: {
    revision: number;
    values: Record<string, Record<string, Record<string, number | null>>>;
  };
  /** Shared sticky notes (F037). Omitted by rooms created before this field existed. */
  notes?: TableNote[];
  /**
   * F054: per-card timestamps and provenance, keyed by canvas node id (not by title, which can change).
   * Written only by server-ordered commands, never by the simulator; bounded to 48 entries / 12 KiB.
   * Omitted by rooms created before this field existed, so readers fall back to inference.
   */
  cardMeta?: Record<string, CanvasCardMeta>;
  /**
   * F048: rolls issued but not yet consumed by their action. Private to the roller, so projections
   * drop them; the action commit deletes the one it consumed.
   */
  pendingRolls?: TablePendingRoll[];
  actionRevision: number;
  activity: { actorId: string; action: string; at: number }[];
}
