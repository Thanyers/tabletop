import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { CommandAuthority } from './authority';
import type { IdentityRepository, WorkspaceRepository } from './repository';
import { sha256 } from './codec';
import { SESSION_COOKIE_NAME } from './limits';

/**
 * F078-T17: `RoomRepository` implemented session storage it never uses (four
 * methods plus invitation redemption) as silent no-ops, because
 * `WorkspaceRepository` promised them. The session methods live in their own
 * `IdentityRepository` now; a runtime without one fails loudly instead of
 * reporting an expired session.
 */

const TOKEN = 'A'.repeat(43);
const COOKIE = `${SESSION_COOKIE_NAME}=${TOKEN}`;

function request(cookie?: string): IncomingMessage {
  return { headers: cookie ? { cookie } : {} } as IncomingMessage;
}

function workspaceOnly(overrides: Partial<Record<string, unknown>> = {}): WorkspaceRepository {
  return {
    listWorkspaceReferences: vi.fn(async () => []),
    ...overrides,
  } as unknown as WorkspaceRepository;
}

function identityWith(record: { revokedAt: null; csrfHash: string } | null) {
  const stored = record
    ? {
        tokenHash: sha256(TOKEN),
        csrfHash: record.csrfHash,
        actorId: 'actor-1',
        name: 'Owner',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        hardExpiresAt: Number.MAX_SAFE_INTEGER,
        revokedAt: null,
        workspaceId: null,
        rotatedToTokenHash: null,
        rotationTicketHash: null,
      }
    : null;
  const identity = {
    createSession: vi.fn(async () => undefined),
    getSession: vi.fn(async () => stored),
    getRotatedSession: vi.fn(async () => stored),
    touchSession: vi.fn(async () => stored),
    redeemInvitation: vi.fn(async () => { throw new Error('not used'); }),
  };
  return identity as unknown as IdentityRepository & typeof identity;
}

describe('identity port', () => {
  it('fails loudly when a runtime has no session storage instead of pretending the session expired', async () => {
    const authority = new CommandAuthority({ repository: workspaceOnly() });
    await expect(authority.authenticate(request(COOKIE))).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('Session storage is not available'),
    });
  });

  it('uses the injected identity repository for sessions', async () => {
    const csrfHash = sha256(sha256(`tabletop-r1-csrf-v1:${TOKEN}`));
    const identity = identityWith({ revokedAt: null, csrfHash });
    const authority = new CommandAuthority({ repository: workspaceOnly(), identity });

    const session = await authority.authenticate(request(COOKIE));
    expect(session.record.actorId).toBe('actor-1');
    expect(identity.getSession).toHaveBeenCalledWith(sha256(TOKEN));
    expect(identity.touchSession).toHaveBeenCalledTimes(1);
  });

  it('creates a session through the identity repository', async () => {
    const identity = identityWith(null);
    const authority = new CommandAuthority({ repository: workspaceOnly(), identity });

    const result = await authority.createOrRefreshSession(request(), { name: 'New owner' });
    expect(identity.createSession).toHaveBeenCalledTimes(1);
    expect(result.session.record.name).toBe('New owner');
    expect(result.setCookie).toContain('HttpOnly');
  });
});
