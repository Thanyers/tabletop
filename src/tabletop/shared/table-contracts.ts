import type { DomainBase } from './contracts';

/** Data-only program. No scripts, URLs, expressions, or arbitrary capability names. */
export type TableValue = string | number | boolean | null | string[];
export interface TableField { id: string; label: string; type: 'text' | 'number' | 'boolean' | 'list'; required: boolean; min?: number; max?: number; choices?: string[] }
export interface TableCollection { id: string; title: string; fields: TableField[] }
export interface TableRecord { id: string; values: Record<string, TableValue> }
export interface TableSource { id: string; filename: string; text: string; sha256: string; createdAt: number }
export interface TableParameter { id: string; label: string; type: 'text' | 'number' | 'boolean' | 'record'; collection?: string; min?: number; max?: number; choices?: string[] }
export type TableOperand = { literal: TableValue } | { input: string } | { record: string; field: string } | { system: 'actor' | 'seat' | 'turn' };
export interface TableCondition { left: TableOperand; op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; right: TableOperand; message: string }
export interface TableEffect { record: string; field: string; op: 'set' | 'add'; value: TableOperand }
export interface TableAction { id: string; title: string; description: string; roles: ('owner' | 'participant')[]; parameters: TableParameter[]; conditions: TableCondition[]; effects: TableEffect[]; requireTurn: boolean; advanceTurn: boolean }
export interface TableInvariant { id: string; collection: string; fields: string[]; message: string }
export interface TableProgram {
  version: 1; title: string; description: string; collections: TableCollection[]; actions: TableAction[];
  /** Composite unique constraints checked after every action, atomically. */
  invariants: TableInvariant[]; turnOrder: string[];
  evidence: { sourceId: string; quote: string }[]; assumptions: string[];
}
export interface TableChange { kind: 'table'; program: TableProgram; initialRecords: Record<string, TableRecord[]> }
export interface TableState extends DomainBase {
  kind: 'table'; sources: TableSource[]; program: TableProgram | null;
  records: Record<string, TableRecord[]>; turn: string | null;
  actionRevision: number;
  activity: { actorId: string; action: string; at: number }[];
}
