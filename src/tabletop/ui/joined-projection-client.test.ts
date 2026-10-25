import { describe, expect, it, vi } from 'vitest';
import { readJoinedSources, type JoinedReadDeps, type JoinedSourceRequest } from './joined-projection-client';

const SPACE = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const BUDGET = '33333333-3333-4333-8333-333333333333';

const requests: JoinedSourceRequest[] = [
  { workspaceId: PLAN, label: 'ผังกิจกรรม', portId: 'plan', grantId: 'grant-plan' },
  { workspaceId: BUDGET, label: 'งบประมาณ', portId: 'budget', grantId: 'grant-budget' },
];

function ok(portId: string, revision: number, rows: { id: string; values: Record<string, string | number> }[], fields: string[]) {
  return {
    status: 200,
    body: { ok: true, portId, projection: { portId, fields, maxRows: 10 }, rows, sourceDataRevision: revision, grantVersion: 1, readAt: 1 },
  };
}

function deps(handler: JoinedReadDeps['fetchProjection']): JoinedReadDeps {
  return { fetchProjection: handler };
}

describe('a joined read asks every source and maps each answer', () => {
  it('returns the live state with rows, fields and revision', async () => {
    const result = await readJoinedSources(SPACE, requests, deps(async input => (
      input.port === 'plan'
        ? ok('plan', 3, [{ id: 'p1', values: { room: 'ห้องประชุม' } }], ['room'])
        : ok('budget', 7, [{ id: 'b1', values: { price: 1250 } }], ['price'])
    )));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ status: 'live', dataRevision: 3, fields: ['room'] });
    expect(result[1]).toMatchObject({ status: 'live', dataRevision: 7, fields: ['price'] });
  });

  it('asks with the space, source, grant and port — never with a caller-supplied actor', async () => {
    const seen: { spaceWorkspaceId: string; source: string; grant: string; port: string }[] = [];
    await readJoinedSources(SPACE, requests, deps(async input => {
      seen.push({ spaceWorkspaceId: input.spaceWorkspaceId, source: input.source, grant: input.grant, port: input.port });
      return { status: 404, body: { ok: false, errorCode: 'SPACE_GRANT_NOT_FOUND' } };
    }));
    expect(seen).toEqual([
      { spaceWorkspaceId: SPACE, source: PLAN, grant: 'grant-plan', port: 'plan' },
      { spaceWorkspaceId: SPACE, source: BUDGET, grant: 'grant-budget', port: 'budget' },
    ]);
  });

  it('maps a revocation and a stale epoch to the states the panel renders', async () => {
    const result = await readJoinedSources(SPACE, requests, deps(async input => (
      input.port === 'plan'
        ? { status: 409, body: { ok: false, errorCode: 'SPACE_GRANT_REVOKED' } }
        : { status: 409, body: { ok: false, errorCode: 'SPACE_GRANT_STALE_EPOCH' } }
    )));
    expect(result.map(source => source.status)).toEqual(['revoked', 'stale']);
  });

  it('maps an unlinked source, an unknown grant and an unknown code to missing', async () => {
    const result = await readJoinedSources(SPACE, requests, deps(async input => (
      input.port === 'plan'
        ? { status: 404, body: { ok: false, errorCode: 'SPACE_SOURCE_NOT_LINKED' } }
        : { status: 418, body: { ok: false, errorCode: 'SOMETHING_ELSE' } }
    )));
    expect(result.map(source => source.status)).toEqual(['missing', 'missing']);
  });

  it('keeps the other sources when one read throws', async () => {
    const result = await readJoinedSources(SPACE, requests, deps(async input => {
      if (input.port === 'plan') throw new Error('network down');
      return ok('budget', 9, [{ id: 'b1', values: { price: 5000 } }], ['price']);
    }));
    expect(result[0]).toMatchObject({ status: 'missing', rows: [] });
    expect(result[1]).toMatchObject({ status: 'live', dataRevision: 9 });
  });

  it('never shows rows for a refused source, even if the body carries them', async () => {
    const result = await readJoinedSources(SPACE, requests, deps(async () => ({
      status: 409,
      body: { ok: false, errorCode: 'SPACE_GRANT_REVOKED', rows: [{ id: 'leak', values: { price: 1 } }] },
    })));
    expect(result.every(source => source.rows.length === 0)).toBe(true);
  });

  it('treats a 200 with a malformed body as missing rather than trusting it', async () => {
    const result = await readJoinedSources(SPACE, requests, deps(async () => ({ status: 200, body: { ok: true } })));
    expect(result.map(source => source.status)).toEqual(['missing', 'missing']);
  });

  it('passes an abort signal through so a closed tool stops reading', async () => {
    const controller = new AbortController();
    const spy = vi.fn(async (_input: { signal?: AbortSignal }) => ok('plan', 1, [], ['room']));
    await readJoinedSources(SPACE, [requests[0]!], { fetchProjection: spy, signal: controller.signal });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal });
  });
});
