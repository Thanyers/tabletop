import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SESSION_TOKEN_BYTES } from './limits.js';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_JSON_VALUE');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('INVALID_JSON_VALUE');
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('INVALID_JSON_VALUE');
      output[key] = canonicalValue(record[key]);
    }
    return output;
  }
  throw new Error('INVALID_JSON_VALUE');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function keyedSha256(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function randomToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function randomId(): string {
  return randomUUID();
}

export function constantTimeHashEqual(expectedHash: string, suppliedValue: string): boolean {
  const actual = Buffer.from(sha256(suppliedValue), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('DATABASE_JSON_INVALID');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`DATABASE_FIELD_INVALID:${field}`);
  return value;
}

export function readNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new Error(`DATABASE_FIELD_INVALID:${field}`);
  return parsed;
}

export function readNullableNumber(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : readNumber(value, field);
}
