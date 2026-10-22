import type { DomainBase } from './contracts';
import type { GenerativeCanvas, GenerativeExpression } from './generative-contracts';
import type { RollSpec, TablePendingRoll } from './roll';

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
  /** Optional local canvas descriptions; omitted by existing version 1 programs. */
  canvas?: GenerativeCanvas;
}
export interface TableChange { kind: 'table'; program: TableProgram; initialRecords: Record<string, TableRecord[]> }
/** Row-relative arithmetic over stored number fields (F017). Kept out of the program schema so old writers still read the table. */
export type ComputedExpression =
  | { op: 'field'; field: string }
  | { op: 'literal'; value: number }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: ComputedExpression; right: ComputedExpression };
export interface ComputedColumn { id: string; collection: string; label: string; expression: ComputedExpression }
/** F037: a shared canvas note. Kept out of the program so it survives rule edits and stays a plain note. */
export type NoteColor = 'yellow' | 'rose' | 'sky' | 'mint' | 'lavender' | 'sand';
export interface TableNote { id: string; text: string; color: NoteColor; x: number; y: number; width: number; height: number; createdBy: string; createdAt: number; updatedAt: number }
export interface TableState extends DomainBase {
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
  /** Display-only computed columns; definitions live in state, not in the program (F017). */
  computedColumns?: ComputedColumn[];
  /** Shared sticky notes (F037). Omitted by rooms created before this field existed. */
  notes?: TableNote[];
  /**
   * F048: rolls issued but not yet consumed by their action. Private to the roller, so projections
   * drop them; the action commit deletes the one it consumed.
   */
  pendingRolls?: TablePendingRoll[];
  actionRevision: number;
  activity: { actorId: string; action: string; at: number }[];
}
