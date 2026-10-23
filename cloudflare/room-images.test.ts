import { randomBytes, randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Room } from './room.js';
import type { Env } from './contracts.js';
import { csrfForToken } from './auth.js';
import { sha256 } from '../server/codec.js';
import { UNPINNED_IMAGE_GRACE_MS } from './room-repository.js';
import { IMAGE_ID_PATTERN, MAX_IMAGE_BYTES, MAX_TABLE_IMAGES } from '../src/tabletop/shared/canvas-images.js';
import type { CommandAck, WorkspaceView } from '../src/tabletop/shared/contracts.js';

// F073: picture upload and read route on the Room Durable Object. Helpers mirror cloudflare/room.test.ts.
const runtime = env as Env;
const ORIGIN = 'https://tabletop.test';

interface TestActor { id: string; name: string; token: string; csrf: string }
interface PublicError { ok: false; errorCode: string }

function newActor(name: string): TestActor {
  const token = randomBytes(32).toString('base64url');
  return { id: randomUUID(), name, token, csrf: csrfForToken(token) };
}

async function saveActor(actor: TestActor): Promise<void> {
  const now = Date.now();
  await runtime.DB.prepare(`INSERT INTO users(id, provider_sub, email, name, is_admin, created_at)
    VALUES (?, ?, ?, ?, 0, ?)`).bind(actor.id, `test:${actor.id}`, `${actor.id}@example.test`, actor.name, now).run();
  await runtime.DB.prepare(`INSERT INTO web_sessions(token_hash, csrf_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(
    sha256(actor.token), sha256(actor.csrf), actor.id, now, now, now + 7 * 24 * 60 * 60 * 1000,
  ).run();
}

function roomStub(roomId: string): DurableObjectStub<Room> {
  return runtime.ROOMS.get(runtime.ROOMS.idFromName(roomId)) as DurableObjectStub<Room>;
}

function headers(actor: TestActor, mutation = false): Headers {
  const value = new Headers({
    Cookie: `__Host-tabletop_session=${actor.token}`,
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
  });
  if (mutation) value.set('X-CSRF-Token', actor.csrf);
  return value;
}

async function call<T>(
  stub: DurableObjectStub<Room>,
  path: string,
  actor: TestActor,
  options: { method?: string; body?: unknown; mutation?: boolean } = {},
): Promise<{ response: Response; body: T }> {
  const response = await stub.fetch(new Request(`${ORIGIN}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...Object.fromEntries(headers(actor, options.mutation ?? options.method === 'POST')),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }));
  return { response, body: await response.json() as T };
}

async function createTable(actor: TestActor) {
  const roomId = randomUUID();
  const stub = roomStub(roomId);
  const result = await call<WorkspaceView>(stub, '/internal/create', actor, {
    method: 'POST', body: { id: roomId, kind: 'table', title: 'Image table' }, mutation: true,
  });
  expect(result.response.status).toBe(201);
  return { roomId, stub };
}

async function invite(stub: DurableObjectStub<Room>, roomId: string, owner: TestActor, actor: TestActor, seat: string): Promise<void> {
  const invitation = await call<{ ticket: string }>(stub, `/api/workspaces/${roomId}/invites`, owner, {
    method: 'POST', body: { seat }, mutation: true,
  });
  expect(invitation.response.status).toBe(201);
  const redeemed = await call<WorkspaceView>(stub, '/internal/redeem', actor, {
    method: 'POST', body: { ticket: invitation.body.ticket.slice(`${roomId}_`.length) }, mutation: true,
  });
  expect(redeemed.response.status).toBe(200);
}

async function view(stub: DurableObjectStub<Room>, roomId: string, actor: TestActor): Promise<WorkspaceView> {
  return (await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, actor)).body;
}

async function issueCommand(stub: DurableObjectStub<Room>, workspace: WorkspaceView, actor: TestActor, type: string, payload: unknown) {
  return call<CommandAck | PublicError>(stub, `/api/workspaces/${workspace.id}/commands`, actor, {
    method: 'POST',
    body: { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch, type, payload },
    mutation: true,
  });
}

async function inspectRoom<T>(stub: DurableObjectStub<Room>, query: string): Promise<T[]> {
  return runInDurableObject(stub, (instance) => instance.repository.storage.sql.exec<T & Record<string, SqlStorageValue>>(query).toArray());
}

/** A body that sniffs as PNG; the server checks only the signature, so a tail byte makes each one distinct. */
function png(tail: number[] = []): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, ...tail]);
}

async function upload(stub: DurableObjectStub<Room>, roomId: string, actor: TestActor, body: Uint8Array, options: { mutation?: boolean; contentType?: string } = {}) {
  const requestHeaders = headers(actor, options.mutation ?? true);
  requestHeaders.set('Content-Type', options.contentType ?? 'application/octet-stream');
  const response = await stub.fetch(new Request(`${ORIGIN}/api/workspaces/${roomId}/images`, { method: 'POST', headers: requestHeaders, body }));
  const parsed: unknown = await response.json();
  return { response, body: parsed as { imageId: string } & Partial<PublicError> };
}

async function readImage(stub: DurableObjectStub<Room>, roomId: string, actor: TestActor, imageId: string) {
  return stub.fetch(new Request(`${ORIGIN}/api/workspaces/${roomId}/images/${imageId}`, { headers: headers(actor) }));
}

async function tableWithMember(name: string) {
  const owner = newActor(`${name} owner`);
  const member = newActor(`${name} member`);
  const outsider = newActor(`${name} outsider`);
  await Promise.all([saveActor(owner), saveActor(member), saveActor(outsider)]);
  const { roomId, stub } = await createTable(owner);
  await invite(stub, roomId, owner, member, 'member-1');
  return { owner, member, outsider, roomId, stub };
}

describe('canvas images on the Room (F073)', () => {
  it('stores an uploaded PNG, returns a stable id, and shows it to others only once a card pins it', async () => {
    const { owner, member, outsider, roomId, stub } = await tableWithMember('Pin');
    const bytes = png([1, 2, 3]);

    const first = await upload(stub, roomId, owner, bytes, { contentType: 'text/html' });
    expect(first.response.status).toBe(201);
    expect(first.body.imageId).toMatch(IMAGE_ID_PATTERN);
    const again = await upload(stub, roomId, owner, bytes);
    expect(again.response.status).toBe(201);
    expect(again.body.imageId).toBe(first.body.imageId);
    expect(await inspectRoom(stub, 'SELECT id FROM room_images')).toHaveLength(1);
    const imageId = first.body.imageId;

    // Before pinning: the uploader may read it back, other members and outsiders may not.
    const own = await readImage(stub, roomId, owner, imageId);
    expect(own.status).toBe(200);
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(bytes);
    const early = await readImage(stub, roomId, member, imageId);
    expect(early.status).toBe(404);
    await early.arrayBuffer();
    const outsiderEarly = await readImage(stub, roomId, outsider, imageId);
    expect(outsiderEarly.status).toBeGreaterThanOrEqual(400);
    await outsiderEarly.arrayBuffer();

    const added = await issueCommand(stub, await view(stub, roomId, owner), owner, 'table.addNote', { imageId, x: 0, y: 0 });
    expect(added.response.status, JSON.stringify(added.body)).toBe(200);

    const pinned = await readImage(stub, roomId, member, imageId);
    expect(pinned.status).toBe(200);
    expect(pinned.headers.get('content-type')).toBe('image/png');
    expect(pinned.headers.get('x-content-type-options')).toBe('nosniff');
    expect(pinned.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await pinned.arrayBuffer())).toEqual(bytes);

    // Still members only, even when pinned.
    const outsiderLate = await readImage(stub, roomId, outsider, imageId);
    expect(outsiderLate.status).toBeGreaterThanOrEqual(400);
    await outsiderLate.arrayBuffer();

    // An unknown id is a plain 404.
    const missing = await readImage(stub, roomId, owner, `img_${'0'.repeat(32)}`);
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
  });

  it('serves JPEG and WebP with their sniffed type, whatever the upload declared', async () => {
    const { owner, roomId, stub } = await tableWithMember('Types');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const webp = new Uint8Array([...new TextEncoder().encode('RIFF'), 0x24, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
    for (const [bytes, mime] of [[jpeg, 'image/jpeg'], [webp, 'image/webp']] as const) {
      const stored = await upload(stub, roomId, owner, bytes, { contentType: 'image/png' });
      expect(stored.response.status).toBe(201);
      const read = await readImage(stub, roomId, owner, stored.body.imageId);
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toBe(mime);
      await read.arrayBuffer();
    }
  });

  it('refuses non-image bytes, oversize bodies, missing CSRF and non-members', async () => {
    const { owner, outsider, roomId, stub } = await tableWithMember('Refuse');

    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<!doctype html><p>hi', 'GIF89a......']) {
      const refused = await upload(stub, roomId, owner, new TextEncoder().encode(text), { contentType: 'image/png' });
      expect(refused.response.status).toBe(415);
      expect(refused.body.errorCode).toBe('UNSUPPORTED_IMAGE');
    }
    const empty = await upload(stub, roomId, owner, new Uint8Array());
    expect(empty.response.status).toBe(415);

    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png());
    const tooLarge = await upload(stub, roomId, owner, big);
    expect(tooLarge.body.errorCode).toBe('BODY_TOO_LARGE');
    expect(tooLarge.response.status).toBe(400);

    // Exactly at the limit is still accepted.
    const atLimit = new Uint8Array(MAX_IMAGE_BYTES);
    atLimit.set(png([9]));
    expect((await upload(stub, roomId, owner, atLimit)).response.status).toBe(201);

    const noCsrf = await upload(stub, roomId, owner, png([4]), { mutation: false });
    expect(noCsrf.response.status).toBe(403);

    const byOutsider = await upload(stub, roomId, outsider, png([5]));
    expect(byOutsider.response.status).toBe(403);

    // Only the at-limit picture was stored.
    expect(await inspectRoom(stub, 'SELECT id FROM room_images')).toHaveLength(1);
  });

  it('rejects other methods on the image routes', async () => {
    const { owner, roomId, stub } = await tableWithMember('Method');
    const stored = await upload(stub, roomId, owner, png([6]));
    const requestHeaders = headers(owner, true);
    const removal = await stub.fetch(new Request(`${ORIGIN}/api/workspaces/${roomId}/images/${stored.body.imageId}`, { method: 'DELETE', headers: requestHeaders }));
    expect(removal.status).toBe(405);
    await removal.arrayBuffer();
    const listing = await stub.fetch(new Request(`${ORIGIN}/api/workspaces/${roomId}/images`, { headers: headers(owner) }));
    expect(listing.status).toBe(405);
    await listing.arrayBuffer();
  });

  it('caps a table at MAX_TABLE_IMAGES stored pictures with TABLE_LIMIT 409, but a repeat upload stays idempotent', async () => {
    const { owner, member, roomId, stub } = await tableWithMember('Limit');
    const ids: string[] = [];
    for (let index = 0; index < MAX_TABLE_IMAGES; index += 1) {
      const stored = await upload(stub, roomId, index % 2 === 0 ? owner : member, png([index]));
      expect(stored.response.status, `upload ${index}`).toBe(201);
      ids.push(stored.body.imageId);
    }
    expect(new Set(ids).size).toBe(MAX_TABLE_IMAGES);

    const overflow = await upload(stub, roomId, member, png([200]));
    expect(overflow.response.status).toBe(409);
    expect(overflow.body.errorCode).toBe('TABLE_LIMIT');

    const repeat = await upload(stub, roomId, owner, png([0]));
    expect(repeat.response.status).toBe(201);
    expect(repeat.body.imageId).toBe(ids[0]);
  });

  it('drops unpinned uploads after the grace period and rows from an older epoch, keeping pinned ones', async () => {
    const { owner, roomId, stub } = await tableWithMember('Prune');
    const pinned = (await upload(stub, roomId, owner, png([1]))).body.imageId;
    const stale = (await upload(stub, roomId, owner, png([2]))).body.imageId;
    const oldEpoch = (await upload(stub, roomId, owner, png([3]))).body.imageId;
    const added = await issueCommand(stub, await view(stub, roomId, owner), owner, 'table.addNote', { imageId: pinned, x: 0, y: 0 });
    expect(added.response.status).toBe(200);

    const longAgo = Date.now() - UNPINNED_IMAGE_GRACE_MS - 60_000;
    await runInDurableObject(stub, (instance) => {
      const sql = instance.repository.storage.sql;
      sql.exec('UPDATE room_images SET created_at = ? WHERE id IN (?, ?)', longAgo, pinned, stale);
      sql.exec('UPDATE room_images SET epoch = epoch - 1 WHERE id = ?', oldEpoch);
    });

    const fresh = await upload(stub, roomId, owner, png([4]));
    expect(fresh.response.status).toBe(201);
    const rows = await inspectRoom<{ id: SqlStorageValue }>(stub, 'SELECT id FROM room_images ORDER BY id');
    expect(rows.map((row) => row.id).sort()).toEqual([pinned, fresh.body.imageId].sort());
  });

  it('removes every stored picture when the owner resets the table', async () => {
    const { owner, roomId, stub } = await tableWithMember('Reset');
    const imageId = (await upload(stub, roomId, owner, png([1]))).body.imageId;
    await upload(stub, roomId, owner, png([2]));
    const added = await issueCommand(stub, await view(stub, roomId, owner), owner, 'table.addNote', { imageId, x: 0, y: 0 });
    expect(added.response.status).toBe(200);
    expect(await inspectRoom(stub, 'SELECT id FROM room_images')).toHaveLength(2);

    const reset = await issueCommand(stub, await view(stub, roomId, owner), owner, 'workspace.reset', {});
    expect(reset.response.status, JSON.stringify(reset.body)).toBe(200);
    expect(await inspectRoom(stub, 'SELECT id FROM room_images')).toHaveLength(0);
    const gone = await readImage(stub, roomId, owner, imageId);
    expect(gone.status).toBe(404);
    await gone.arrayBuffer();
  });
});
