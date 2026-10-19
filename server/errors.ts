import type { ApiError } from '../src/tabletop/shared/contracts.js';

export class AuthorityError extends Error {
  constructor(readonly code: string, message = code, readonly status = statusForCode(code)) {
    super(message);
    this.name = 'AuthorityError';
  }
}

export function statusForCode(code: string): number {
  if (code === 'SESSION_REQUIRED' || code === 'SESSION_EXPIRED') return 401;
  if (code === 'WORKSPACE_NOT_FOUND') return 404;
  if (code === 'TOO_MANY_REQUESTS' || code === 'ROOM_LIMIT_REACHED' || code === 'MEMBER_LIMIT_REACHED') return 429;
  if (code === 'STALE_REVISION' || code === 'STALE_EPOCH' || code === 'IDEMPOTENCY_MISMATCH'
      || code === 'INVITE_ALREADY_USED' || code === 'SEAT_UNAVAILABLE' || code === 'SESSION_ALREADY_BOUND') return 409;
  if (code === 'INVALID_JSON' || code === 'INVALID_REQUEST' || code === 'CONTENT_TYPE_REQUIRED'
      || code === 'BODY_TOO_LARGE' || code === 'COMMAND_NOT_ALLOWED' || code === 'TRUSTED_OPERATION_REQUIRED') return 400;
  if (code === 'INTERNAL_ERROR' || code === 'DATABASE_SCHEMA_UNAVAILABLE' || code === 'DATABASE_UNAVAILABLE') return 503;
  return 403;
}

export function safeError(error: unknown, requestId: string): { status: number; body: ApiError } {
  const mapped = error instanceof AuthorityError
    ? error
    : new AuthorityError(codeFromError(error), codeFromError(error));
  return {
    status: mapped.status,
    body: { ok: false, errorCode: mapped.code, message: mapped.message, requestId },
  };
}

function codeFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('DOMAIN:')) return message.slice('DOMAIN:'.length);
  if (message.startsWith('DATABASE_FIELD_INVALID') || message === 'DATABASE_JSON_INVALID'
      || message === 'DATABASE_DOMAIN_STATE_INVALID' || message === 'DATABASE_COMMAND_RESPONSE_INVALID') return 'INTERNAL_ERROR';
  const known = new Set([
    'SESSION_REQUIRED', 'SESSION_EXPIRED', 'WORKSPACE_NOT_FOUND', 'TOO_MANY_REQUESTS', 'ROOM_LIMIT_REACHED',
    'MEMBER_LIMIT_REACHED', 'STALE_REVISION', 'STALE_EPOCH', 'IDEMPOTENCY_MISMATCH', 'INVITE_ALREADY_USED',
    'SEAT_UNAVAILABLE', 'SESSION_ALREADY_BOUND', 'INVALID_JSON', 'INVALID_REQUEST', 'CONTENT_TYPE_REQUIRED',
    'BODY_TOO_LARGE', 'COMMAND_NOT_ALLOWED', 'TRUSTED_OPERATION_REQUIRED', 'ORIGIN_REQUIRED', 'ORIGIN_REJECTED',
    'CSRF_REJECTED', 'MEMBERSHIP_REVOKED', 'ROLE_FORBIDDEN', 'INVITE_INVALID', 'INVITE_EXPIRED',
    'INVITE_NOT_ALLOWED', 'INVITE_SEAT_OCCUPIED', 'SESSION_ROTATION_INVALID', 'DATABASE_SCHEMA_UNAVAILABLE',
    'DATABASE_UNAVAILABLE', 'RATE_LIMITED', 'INVALID_COMMAND_PAYLOAD', 'COMMAND_PAYLOAD_TOO_LARGE',
    'COMMAND_IDENTITY_SPOOF', 'WORKSPACE_EXPIRED', 'SCHEMA_VERSION_UNSUPPORTED', 'IDEMPOTENCY_MISMATCH',
  ]);
  return known.has(message) ? message : 'INTERNAL_ERROR';
}
