import { z } from 'zod';
import { DomainError, type ActorContext } from '../shared/contracts';
import type { Permission } from '../shared/permissions';

export const MAX_SATANG = 9_000_000_000_000;
export const MAX_ROWS = 10_000;
export const ID_SCHEMA = z.string().min(1).max(160).refine((value) => value.trim().length > 0, 'ID cannot be whitespace only');
export const DATE_SCHEMA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isIsoDate, 'Use a real YYYY-MM-DD date');

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}

export function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new DomainError('INVALID_COMMAND', result.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

export function hash(ctx: ActorContext, value: unknown): string {
  return ctx.hash(canonicalJson(value));
}

export function makeId(ctx: ActorContext, prefix: string, value: unknown): string {
  return `${prefix}_${hash(ctx, value)}`;
}

export function sumSafe(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    assert(Number.isSafeInteger(total), 'TOTAL_OVERFLOW', 'The total exceeds the supported safe integer range.');
  }
  return total;
}

export function isWithinWindow(date: string, from: string, to: string | null): boolean {
  return date >= from && (to === null || date < to);
}

export function hasRole(ctx: ActorContext, allowed: ActorContext['role'][]): void {
  assert(allowed.includes(ctx.role), 'FORBIDDEN', `Role ${ctx.role} cannot perform this action.`);
}

/**
 * F035: management commands require a permission from the table's access settings. When the server did not
 * attach permissions (demo practice, legacy callers) the previous role rule applies.
 */
export function requirePermission(ctx: ActorContext, permission: Permission, legacyRoles: ActorContext['role'][]): void {
  if (ctx.permissions) {
    assert(ctx.permissions.has(permission), 'FORBIDDEN', 'Your role at this table cannot do this.');
    return;
  }
  hasRole(ctx, legacyRoles);
}
