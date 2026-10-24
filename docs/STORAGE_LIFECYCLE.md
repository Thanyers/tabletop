# Storage lifecycle and recovery contract

This document names every persistent store Tabletop writes, what one row means, how storage grows, what a
reset or an expiry actually deletes, how long an idempotency receipt can be replayed, and what a restore must
preserve. It is a description of the code at the commit that introduced it, not a retention decision: **no
retention period, deletion policy or restore procedure is approved here.**

Scope: documentation plus a disposable local measurement ([F078-T7a](features/F078-T7a-storage-lifecycle.md)).
Nothing in this work deletes, compacts, expires or migrates saved data, and no schema, retention default or
runtime behavior changes. Automated restore is out of scope; [T7b](features/F078-architecture-improvements.md)
is the separate rehearsal task.

## 1. Store inventory

| Store | Runtime | Owner | Lives in | One row means | Deleted by |
| --- | --- | --- | --- | --- | --- |
| Room SQLite | Hosted Worker + Cloudflare emulator | One Room Durable Object per room id | `DurableObjectState.storage.sql` | See §2 | Members' explicit `workspace.reset` only |
| D1 directory | Hosted Worker | Worker (`cloudflare/index.ts`, `auth.ts`) | D1 database, migrations `0001`, `0002` | See §3 | Directory rows are updated in place; only expired `oauth_states`, `web_sessions` and `edge_limits` are swept |
| Billing SQLite | Hosted Worker | The single Billing Durable Object `global` | `DurableObjectState.storage.sql` | One AI job's reservation and settlement | Never |
| Node SQLite | Local Node guest | `SqlWorkspaceRepository` over PGlite or Postgres | `server/schema.sql` (13 tables) | See §5 | Expiry sweep or `workspace.reset` |
| Local blob store | Local Node guest | `LocalObjectStore` | `<dataDir>/objects/<uuid>` files | One uploaded private object | Reset/expiry cleanup queue |

The client, the Worker request path and the Canvas hold no durable state of their own; browser storage holds
UI preferences and consent, which this contract does not treat as a system of record.

## 2. Room Durable Object SQLite

### 2.1 Schema application, not migration

`RoomRepository`'s constructor re-applies the `TABLES` array on **every** construction:

```ts
// cloudflare/room-repository.ts:293-301
constructor(storage: DurableObjectStorage, roomId: string | null = null) {
  this.storage = storage;
  this.storage.transactionSync(() => {
    for (const statement of TABLES) this.storage.sql.exec(statement);
  });
  const persisted = this.rows('SELECT room_id FROM room_identity WHERE singleton = 1')[0];
```

There is no Room migration ledger, no `schema_version` table and no down path. Every statement in `TABLES`
(`cloudflare/room-repository.ts:85-158`) is `CREATE TABLE IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS`, so a
re-opened room never rewrites an existing column or constraint. A future column change would need a new
statement that is idempotent and additive; it could not be expressed as an `ALTER` here without a separate
mechanism. The `schema_version` column in `room_workspaces` is the **domain** schema version
(`SCHEMA_VERSION = 1` in `server/limits.ts:53`), not the database schema version. `RoomRepository.isReady`
only runs `SELECT 1` (`cloudflare/room-repository.ts:450-453`), so it does not detect a stale table shape.

### 2.2 Tables and what one row means

There are 14 tables and 5 indexes. All rows belong to the single workspace id bound by `room_identity`.

| Table | Key | One row means | Lifetime in the code |
| --- | --- | --- | --- |
| `room_identity` | `singleton = 1` | The room UUID this storage belongs to. `room_id` is unique. | Written once on first bind; never deleted. A mismatch throws `ROOM_ID_MISMATCH`. |
| `room_workspaces` | `id` | **Current** state: `epoch`, `revision`, `projection_salt`, `domain_state` JSON, `state_hash`, `schema_version`, `created_at`, `expires_at`. | Updated in place on every commit; survives reset. |
| `room_memberships` | `(workspace_id, epoch, actor_id)` | One actor's membership in one epoch: name, role, seat, `created_at`, `revoked_at`. | Revoked rows stay; reset deletes all rows and inserts the owner at the new epoch. |
| `room_invitations` | `ticket_hash` | One single-use invitation: epoch, role, seat, `expires_at`, redemption and revocation. | Expired rows are **not** deleted; reset deletes the table's rows. |
| `room_invite_links` | `token_hash` | One reusable invite link per table epoch; only the token hash is stored. | Disabled by `revoked_at`; reset deletes rows. |
| `room_snapshots` | `(workspace_id, epoch, revision)` | A **full** copy of the domain state at one revision, plus its hash. | One row per creation, per commit and per reset; no cap, no deletion outside reset. |
| `room_events` | `event_id`, unique `(workspace_id, epoch, workspace_sequence)` | One committed domain event with its payload. | Appended per commit; sequence is `MAX(sequence)+1` within the epoch. Frozen history; deleted only by reset. |
| `room_commands` | `(workspace_id, epoch, actor_id, command_id)` | An **idempotency receipt**: `payload_hash`, the full stored response and the `event_id` it produced. | Appended per commit; never expires; deleted only by reset. |
| `room_outbox` | `outbox_id` | One event waiting for projection delivery (`delivered_at`). | `delivered_at` is set after broadcast; rows are **retained**, so this table also grows per commit. |
| `room_artifact_cleanup` | `(workspace_id, epoch, object_key)` | A private object that must be removed after reset (invoice sources). | Written on reset; **not** deleted by reset itself. |
| `room_approvals` | `approval_id` | An activation approval bound to epoch, approving actor, candidate hash and proof hash. | Upserted when a candidate carries an approval; reset deletes rows. |
| `model_jobs` | `id` | One model job: `status` (`running`, `committing`, `completed`, `failed`, `revoked`), `data` JSON, `created_at`, `revoked_at`. | Rows are retained; reset rewrites older epochs (§7). No pruning. |
| `room_directory_outbox` | autoincrement `id` | One pending membership change for the D1 directory; its id is the `directory_sequence` watermark. | Deleted after a successful D1 sync. This is the only self-cleaning queue. |
| `room_images` | `(workspace_id, id)` | One canvas image: mime, `bytes` BLOB, size, uploader. | Kept until reset; superseded/stale unpinned uploads are dropped on the next upload (`UNPINNED_IMAGE_GRACE_MS = 10 min`). |

### 2.3 What one commit writes

The Room adapter's commit path writes the current state, one full snapshot, one event, one receipt and one
outbox row in one `transactionSync`:

```ts
// cloudflare/room-repository.ts:406-430
this.updateWorkspace(workspace);
this.insertSnapshot(workspace, event.createdAt);
const sequenceRows = this.rows<{ next_sequence: SqlStorageValue }>(
  `SELECT COALESCE(MAX(workspace_sequence), 0) + 1 AS next_sequence
   FROM room_events WHERE workspace_id = ? AND epoch = ?`, ...);
...
this.storage.sql.exec(
  `INSERT INTO room_events(event_id, workspace_id, epoch, workspace_sequence, actor_id, command_id,
    event_type, event_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...);
this.storage.sql.exec(
  `INSERT INTO room_commands(workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ...);
this.storage.sql.exec(
  `INSERT INTO room_outbox(outbox_id, workspace_id, epoch, event_id, created_at, delivered_at)
   VALUES (?, ?, ?, ?, ?, NULL)`, ...);
```

`updateWorkspace` rewrites the whole `domain_state` JSON (`cloudflare/room-repository.ts:356-365`), so even a
layout-only commit copies the full state. The receipt stores the complete `CommandAck`, including the
projected `WorkspaceView`, and the event stores its own payload; both scale with the table state, not with a
small delta.

### 2.4 Caps that do not bound storage

- `COMPUTE_LIMITS.runHistory = 24` (`src/tabletop/shared/table-compute.ts:135`) trims the **visible** run list
  inside the state. It does not stop a new `room_snapshots` row per commit.
- `MAX_TABLE_ASSISTANT_JOBS_PER_ROOM = 500` (`cloudflare/room-repository.ts:82`) **rejects new assistant jobs**
  with `TABLE_ASSISTANT_HISTORY_LIMIT` (`cloudflare/room-repository.ts:836-838`); it does not delete old rows.
- Invitation `expires_at` and `room_images` limits reject or hide work; they do not remove committed history.
- Delivered outbox rows and revoked `model_jobs` are retained.

The only bounded-history behavior in this adapter is the reset in §7; there is no compaction or retention
policy. `RoomRepository.expireWorkspaces` is a no-op:

```ts
// cloudflare/room-repository.ts:455-458
async expireWorkspaces(_now: number, _limit?: number): Promise<number> {
  // Room lifetimes are persistent in the hosted deployment; expiry is disabled here.
  return 0;
}
```

A hosted room's `expires_at` is `ROOM_EXPIRES_AT = 253_402_300_799_000` (`cloudflare/room.ts:52`), i.e. the end
of year 9999, and the command path still rejects a workspace whose `expires_at <= now`
(`server/authority.ts:808`). So expiry is unreachable for hosted rooms, and no sweep exists to apply it.

## 3. D1 directory

Migrations are applied explicitly (`cloudflare/migrations/0001_identity.sql`,
`0002_table_kind.sql`); there is no remote auto-migration. Seven tables:

| Table | One row means |
| --- | --- |
| `app_meta` | One key/value metadata entry. |
| `users` | One OIDC identity: provider subject, email, name, admin flag. |
| `web_sessions` | One browser session: token hash, CSRF hash, user, `expires_at`, `revoked_at`. |
| `oauth_states` | One in-flight OIDC state/nonce/binding, with `expires_at`. |
| `rooms` | One discoverable room: id, owner id, kind, `created_at`. |
| `room_members` | One `(user, room)` directory entry: `epoch`, `active`, `directory_sequence`. |
| `edge_limits` | One rate-limit key with its window start and hit count. |

`room_members.directory_sequence` is the ordering column. The Room emits a pending change per membership
event (`room_directory_outbox.id` is the sequence), and the Worker applies it with a monotonic guard:

```ts
// cloudflare/room.ts:1755-1761
`INSERT INTO room_members(user_id, room_id, epoch, active, directory_sequence) VALUES (?, ?, ?, ?, ?)
 ON CONFLICT(user_id, room_id) DO UPDATE SET epoch = excluded.epoch, active = excluded.active,
   directory_sequence = excluded.directory_sequence
 WHERE excluded.directory_sequence > room_members.directory_sequence
   AND excluded.epoch >= room_members.epoch`
```

D1 is a **discovery index, never the authorization decision**: `index.ts` lists a user's rooms from
`room_members` (`cloudflare/index.ts:65`), while every command and read is authorized against Room membership
(`server/authority.ts:809-810`). A stale or tampered directory row can hide or show a room in the list; it
cannot grant access. The only application deletes in D1 are the maintenance sweep of expired `oauth_states`,
`web_sessions` and `edge_limits` (`cloudflare/index.ts:214-216`); `users`, `rooms` and `room_members` are not
deleted by the application. Conversely, a restore that moves D1 ahead of the Room is not automatically
repairable: the upsert refuses a lower epoch, so D1 rows newer than the Room must be corrected explicitly.

## 4. Billing Durable Object

One SQLite table, `billing_jobs` (`cloudflare/billing.ts:206-229`), in a **single global instance** named
`global` (`cloudflare/ai.ts:293`: `env.BILLING.idFromName('global')`). One row is one AI job binding:

| Column | Meaning |
| --- | --- |
| `id`, `actor_id`, `workspace_id`, `epoch`, `input_hash` | The job binding. A duplicate reserve with the same binding returns the stored row; any mismatch is `BILLING_CONFLICT`. |
| `max_input_tokens`, `max_output_tokens` | The reserved budget the request was admitted with. |
| `reserved_micro_usd`, `actual_micro_usd` | Reserved price and settled price (integer micro-USD). |
| `status` | `reserved` → `dispatching` → `settled`, or `uncertain`. |
| `created_at`, `day_key`, `month_key` | Creation time and UTC quota buckets. |
| `lease_expires_at` | Reservation lease (5 min) or dispatch lease (2 min); `NULL` once uncertain/settled. |
| `prompt_tokens`, `completion_tokens`, `cache_hit_tokens`, `cache_miss_tokens`, `reasoning_tokens` | Settled usage. |

Statuses are enforced by a `CHECK` constraint. `dispatch` moves `reserved` → `dispatching` only while the
reservation lease is valid; an expired reservation becomes `uncertain` instead of being dispatched
(`cloudflare/billing.ts:314-324`). `settle` accepts `dispatching` or `uncertain`, and an `uncertain` settlement
is idempotent (`cloudflare/billing.ts:338-343`). The alarm marks expired `reserved`/`dispatching` rows
`uncertain` (`cloudflare/billing.ts:380-389`) and re-arms at the next lease. Rows are never deleted; daily quota
counts are derived from existing rows, so losing billing rows would silently relax quotas.

## 5. Node / PGlite adapter

`server/schema.sql` defines 13 tables: `schema_migrations`, `authority_meta`, `sessions`, `workspaces`,
`memberships`, `invitations`, `snapshots`, `events`, `commands`, `outbox`, `artifact_cleanup`, `approvals`,
`model_jobs`. One row means the same thing as its Room counterpart, with these differences:

- `sessions` exist here (guest sessions), and `authority_meta` holds the singleton workspace-count lock.
- `workspaces.expires_at` is `WORKSPACE_TTL_MS = 7 days` by default (`server/limits.ts:5`) and is applied by
  the expiry sweep, unlike the hosted Room.
- `schema_migrations` stores `DATABASE_SCHEMA_VERSION = 5` (`server/limits.ts:55`), and `isReady` fails when the
  highest applied version does not equal it (`server/repository.ts:411-417`). `migrateDatabase` re-applies
  `server/schema.sql` and inserts the version row (`server/migrations.ts:8-23`); it is also create-only.
- There are no `room_images`, `room_invite_links` or `room_directory_outbox` tables: the Node adapter has no
  reusable link, no canvas image blob storage and no directory sync.
- The outbox is drained by the HTTP app (`server/app.ts:314-344`), which sets `delivered_at` and retains rows.
- `artifact_cleanup` is drained by `bootstrap.ts` at startup and every 5 s (`server/bootstrap.ts:19-35`), which
  removes local files through `LocalObjectStore`.

The Node commit path writes the same five things (`server/repository.ts:972-1009`):

```ts
UPDATE workspaces SET title = $2, ... WHERE id = $1          // 972-979
INSERT INTO snapshots (...) VALUES (...)                      // 980-985
INSERT INTO events (...) VALUES (...)                         // 992-998
INSERT INTO commands (...) VALUES (...)                       // 999-1004
INSERT INTO outbox (...) VALUES (...)                         // 1005-1009
```

## 6. Local blob store

`LocalObjectStore` writes one file per object under `<dataDir>/objects/<uuid>`
(`server/storage.ts:8-13`), created with mode `0600` in a directory created with `0700`. The key is a UUID
validated by a strict pattern; the content is not in SQL. `server/bootstrap.ts:13,15` wires
`<dataDir>/objects`. This store exists only in the Node guest runtime and is not part of the hosted deployment.

## 7. Growth model

One commit writes **current state + one full snapshot + one event + one receipt + one outbox row** (§2.3,
§5). Rows accumulate until a reset (Room) or a reset/expiry (Node). Consequently:

- Stored bytes grow with `commits × snapshot size`. Caps on the number of visible runs, records or images do
  not bound that volume.
- `room_snapshots`/`snapshots` and receipts both scale with state size, because receipts store the full
  response and events store their payload.
- Delivered outbox rows and revoked model jobs are retained, so they also grow per commit/job.
- The visible compute-history cap (24 runs) trims state, not history (§2.4).

### Known measurement

`scripts/storage-growth.ts` runs a synthetic table through the real `CommandAuthority` and
`SqlWorkspaceRepository` against a fresh in-memory PGlite database, across two workspaces, and samples every
relation with `pg_total_relation_size` plus `COUNT(*)` at four commit points. Results on Node `v22.23.2`,
PGlite `0.5.10`, Windows x64 (`scripts/storage-growth.ts` defaults, 2026-10-24):

| Point | Commits (both workspaces) | Total relation bytes | Snapshots rows |
| --- | --- | --- | --- |
| 1 | 0 | 761,856 | 12 |
| 2 | 16 | 933,888 | 28 |
| 3 | 32 | 1,105,920 | 44 |
| 4 | 48 | 1,286,144 | 60 |

That is 524,288 relation-byte growth over 48 commits ≈ **10,923 bytes per commit** for this 20-record
workload. Raising the fixture to 100 records raised the slope to **15,189 bytes per commit** (786,432 →
1,515,520 bytes over the same commit budget). Relation bytes come from `pg_total_relation_size`, i.e. the heap,
its indexes and TOAST, quantized to 8 KiB pages. They are **not** process memory, the whole PGlite image, WAL,
or filesystem allocation, and nothing here is a capacity claim for hosted D1, Room SQLite or Billing.

## 8. Reset and scrub semantics

Both adapters implement `workspace.reset` (owner only) as an epoch bump plus a scrub. They are **not**
identical.

### Room adapter (`cloudflare/room-repository.ts:369-404`)

1. Queue every active member of the previous epoch as inactive in `room_directory_outbox`; queue the reset
   owner as active.
2. For invoice state, queue each source artifact in `room_artifact_cleanup`.
3. Delete **every row for the workspace regardless of epoch** from `room_outbox`, `room_commands`,
   `room_events`, `room_snapshots`, `room_invitations`, `room_invite_links`, `room_approvals`, `room_images`.
4. Rewrite `model_jobs` rows with `epoch < new epoch` to `status = 'revoked'`, `revoked_at` set, and scrub
   `data` to `{"kind":"table-assistant","failure":"ROOM_RESET"}` for assistant jobs or `{}` otherwise.
5. Delete **all** `room_memberships` rows and insert the reset owner at the new epoch.
6. Update the workspace row, then write one snapshot, one event, the reset receipt and one outbox row.

`room_artifact_cleanup` rows are not deleted by the reset; they are left for a consumer. At this commit
`listPendingArtifactCleanup` has **no caller in `cloudflare/`**; only the Node `bootstrap.ts` drains its queue.
Hosted rooms do not accept invoice uploads, so the queue is only reachable through an invoice-kind reset and
would then accumulate rows.

### Node adapter (`server/repository.ts:910-970`)

1. Queue invoice artifacts in `artifact_cleanup`.
2. Delete rows with `epoch < new epoch` from `outbox`, `commands`, `events`, `snapshots`, `invitations`,
   `approvals`, `memberships`. Rows of the new epoch are untouched.
3. Preserve the **reset receipt** explicitly: the command delete carries
   `AND NOT (epoch = $3 AND actor_id = $4 AND command_id = $5)` for the reset command
   (`server/repository.ts:928-932`), because the receipt is written under the previous epoch and would
   otherwise fall inside the delete range.
4. Delete sessions bound to the workspace except the resetting session token
   (`server/repository.ts:959-963`).
5. Rewrite `model_jobs` for `epoch < new epoch` to `revoked` with `data = '{}'` (§ above).
6. Insert the reset owner membership, then update the workspace row and write the snapshot, event, receipt and
   outbox row.

### Expiry

- Hosted Room: disabled (§2.4). No sweep runs and `expires_at` is unreachable.
- Node: `expireWorkspaces` (`server/repository.ts:419-510`) runs at startup (`server/bootstrap.ts:23`) and from
  the HTTP app's timer (`server/app.ts:383-385`) with `MAX_EXPIRY_SWEEP_BATCH = 100`. It deletes rows of **all**
  epochs for that workspace, revokes model jobs, deletes `artifact_cleanup` only after each object is removed,
  removes other sessions, keeps the owner's session unbound, rewrites the workspace to a scrubbed
  `epoch + 1`, inserts a snapshot of the scrub state and sets `purged_at`. The workspace row itself survives.

### Difference summary

| Behavior | Room | Node |
| --- | --- | --- |
| Reset delete scope | every row for the workspace, any epoch | `epoch < newEpoch` only |
| Reset receipt | inserted after the deletes, so it survives | excluded from the delete by `NOT (...)` |
| Images / invite links | deleted | tables do not exist |
| Sessions | no session table | deletes other sessions bound to the workspace |
| Applied expiry | disabled (`expireWorkspaces` returns 0) | 7-day TTL swept at startup/timer |
| Schema version | none (create-only re-apply; domain `schema_version` only) | `schema_migrations` + `DATABASE_SCHEMA_VERSION = 5` |
| Artifact cleanup | rows written, no consumer in `cloudflare/` | drained at startup |
| Membership after reset | all epochs deleted, owner inserted at new epoch | `< newEpoch` deleted, owner inserted at new epoch |

## 9. Idempotency receipts and the replay horizon

A receipt identifies a committed command by `(workspace_id, epoch, actor_id, command_id)` plus the
`payload_hash` of the request. Both adapters look the receipt up before the epoch check
(`server/authority.ts:824-828` runs before `server/authority.ts:840`), so:

- Same key and same `payload_hash`: the stored response is returned with `duplicate: true`; the command is not
  re-executed.
- Same key, different hash: `IDEMPOTENCY_MISMATCH`.
- No receipt: normal execution; if the client's `expectedEpoch` is stale, `STALE_EPOCH` is returned.

**Nothing expires receipts.** There is no TTL column and no cleanup job in either adapter; the only removal is
the reset (and the Node expiry sweep). Therefore the effective replay horizon is:

- Room: **until the next reset** (and a reset has no expiry, so in practice forever for a live room).
- Node: **until reset or expiry** (7-day default TTL plus the sweep).

One nuance follows from preserving the reset receipt: replaying the reset command itself with its original
`expectedEpoch` (the pre-reset epoch) still finds the retained receipt and returns the old acknowledgement
with `duplicate: true`, before the epoch check. Replaying any *other* pre-reset command finds nothing and gets
`STALE_EPOCH`. That retained receipt is the reset's own "lost acknowledgement" recovery path; it is not a
general replay window.

**Open question (not decided):** the required retention/export horizon for receipts, events and snapshots is
**not** decided. This document does not infer a number or an approval to delete anything. Choosing a horizon
is a product/data-retention decision (who may export, for how long, under which jurisdiction) and must be made
explicitly before any retention job is written.

## 10. Recovery contract

### 10.1 What a restore must preserve

A restore is only correct if it preserves:

1. **Membership and epoch.** The owner/member set, roles, seats, `revoked_at`, and the current `epoch`. Commands
   carry `expectedEpoch` and are rejected on a mismatch; a rollback to an older epoch is a data-loss event, not
   a retry.
2. **Receipts and their responses.** A client retrying a lost acknowledgement must receive the same result, not
   a second execution. A receipt whose `event_id`/`payload_hash` no longer matches the event log must not be
   kept.
3. **Uncertain billing outcomes.** `settled` and `uncertain` rows must come back exactly as they were; a job
   must never return to `reserved` or `dispatching` with a live lease, because that is what would allow a second
   dispatch of an already-charged request.
4. **Directory sequence ordering.** `room_members.directory_sequence` must never move backwards, and D1's
   `epoch` must not be ahead of the Room's epoch in a way the upsert guard refuses.
5. **Feed and cursor continuity.** The projection cursor is a hash of revision (and layout revision); the
   event feed is ordered by `(workspace, epoch, workspace_sequence)`. Restoring a different state under the
   same cursor silently mislabels history, so a restore that changes state must change the revision or force a
   resync.
6. **Schema/writer version.** The writer that produced the backup must be named and supported by the code that
   reads it.

### 10.2 Recovery manifest

A restore should carry at least:

| Field | Source | Why |
| --- | --- | --- |
| Writer/schema version | `DATABASE_SCHEMA_VERSION` (Node), `room_workspaces.schema_version` + the applied `TABLES` shape (Room), D1 migration names, Billing table shape | Reject a backup the current code cannot read. |
| Room id + `room_identity` | `room_identity`, `room_workspaces.id` | A Room instance must not bind another room id (`ROOM_ID_MISMATCH`). |
| Workspace epoch, revision, `state_hash`, `projection_salt` | `room_workspaces` | Epoch activates commands; revision/cursor keep clients honest; the salt reproduces the projection hash. |
| Snapshot for the restored revision | `room_snapshots` / `snapshots` | Verifies the current state matches the recorded hash. |
| Max event sequence per `(workspace, epoch)` | `room_events` / `events` | The next commit allocates `MAX + 1`; a gap or a reused sequence breaks the feed's unique constraint. |
| Retained receipts + `payload_hash` + `event_id` | `room_commands` / `commands` | Replay safety; the reset receipt must be identified as such. |
| Outbox rows and `delivered_at` | `room_outbox` / `outbox` | Undelivered rows are still owed to clients; delivered rows may be replayed harmlessly. |
| Directory watermark | `room_directory_outbox` (next id), `room_members.directory_sequence` | Prevent a replayed directory change from regressing. |
| Billing reconciliation | `billing_jobs` rows: id, binding, status, `actual_micro_usd`, lease | Detect jobs that must be settled or marked uncertain, never re-dispatched. |
| Node session and object state | `sessions`, `<dataDir>/objects`, `artifact_cleanup` | Guest sessions must not resurrect revoked/expired access; queued object removals must not be lost or replayed twice. |

### 10.3 Invariants a restore must satisfy

- Exactly one `room_workspaces` row per room; its `epoch`/`revision`/`state_hash` must match the snapshot for
  that revision.
- For every retained pre-reset receipt, an event with the same `event_id` exists in the same
  `(workspace, epoch)`. The reset receipt is the explicit exception: its receipt row keeps the pre-reset epoch
  while its event is written in the new epoch, so a restore must identify it rather than reject the pair as
  corrupt. Every event sequence is unique and dense enough that `MAX + 1` is the next sequence.
- `room_identity.room_id` is the room being restored, or the restore target is empty.
- No `billing_jobs` row with a charged or settled outcome may be replayed to a dispatchable state. Billing
  restore must never lead to dispatching an already-charged request twice; `uncertain` is the correct
  recoverable outcome for an unknown provider result.
- D1 `room_members` rows must not claim an epoch higher than the Room's, and the directory sequence must be
  monotonic per `(user, room)`.
- Sessions restored from an older backup must be re-validated against expiry and revocation, and commands
  re-check membership regardless (§3).
- Pre-reset snapshots must not be reintroduced alongside a post-reset epoch: the live code would never write
  that pair, and the snapshot key includes the epoch.

## 11. What this document does not prove

- **No coordinated D1 + Room + Billing restore exists.** There is no cross-store transaction, no shared
  manifest writer and no restore driver in the repository.
- **No Durable Object or D1 backup/restore tooling exists in the repo.** There is no backup script, export
  command or restore CLI; `wrangler` configuration contains no backup job.
- **No production restore has been performed or rehearsed.** The only related work is F078-T2's disposable
  local measurement and the T7b rehearsal that this contract unblocks.
- **RPO/RTO for hosted storage are unknown.** Cloudflare D1/DO retention and point-in-time behavior are not
  described or verified here; no number in this document should be read as an RPO/RTO commitment.
- The measurement in §7 is local, synthetic and PGlite-only. It says nothing about hosted D1, Room SQLite,
  Billing SQLite, process memory, WAL or physical disk, and it is not a capacity claim.
- **The receipt/event/snapshot retention horizon is undecided** (§9), so any cleanup job would be premature.

## 12. Open questions

1. What retention/export horizon applies to receipts, events and snapshots, and who approves deletion? (Not
   decided; do not infer a number.)
2. What is the hosted RPO/RTO, and which backup primitive (D1 export, DO storage snapshot, provider feature)
   is acceptable for each store?
3. Who owns the Room's `room_artifact_cleanup` consumer, and should the hosted adapter drain it or stop writing
   to it?
4. Should the Room schema gain an explicit database version and idempotent additive migrations before any
   column change is attempted?

## References

- [F078-T7a feature record](features/F078-T7a-storage-lifecycle.md)
- [Current architecture](CURRENT_ARCHITECTURE.md)
- [R1 architecture](R1_ARCHITECTURE.md) (historical; see its extension notices)
- [Repository conformance](REPOSITORY_CONFORMANCE.md)
- [Architecture baseline](ARCHITECTURE_BASELINE.md)
- `cloudflare/room-repository.ts`, `cloudflare/room.ts`, `cloudflare/billing.ts`, `cloudflare/index.ts`,
  `cloudflare/migrations/`, `server/schema.sql`, `server/repository.ts`, `server/storage.ts`,
  `server/authority.ts`, `scripts/storage-growth.ts`
