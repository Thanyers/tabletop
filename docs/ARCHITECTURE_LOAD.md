# Local load and soak comparison (F078-T9)

This harness measures what the local runtime can actually observe about load, so that a capacity
decision is made from evidence instead of guessing. It extends the [architecture baseline](ARCHITECTURE_BASELINE.md)
conventions: a fresh in-memory PGlite database, the real `CommandAuthority` and
`SqlWorkspaceRepository`, synthetic data only, and a unique JSON result under the git-ignored
`test-results/` directory.

It changes no infrastructure, concurrency, retention or schema. Its numbers are a single-host
reference, not hosted capacity and not an SLO.

## What it measures

| Signal | How it is produced | What the number means |
| --- | --- | --- |
| Successful command latency | `table.act` through the authority, timed around `authority.execute` | Direct-authority latency for one committed action, per room |
| Stale-command latency | A repeated command against a superseded revision, expecting `STALE_REVISION` | Cost of rejecting a stale write; the rejection must not commit |
| Hot-room latency | Extra commits on room 1 after every room has been driven | Behaviour when one room keeps writing while the others are idle |
| Storage curve | `pg_total_relation_size` over the measured relations at several commit counts | Relation bytes (heap + indexes + TOAST) per point, page-quantized |
| Outbox backlog | `COUNT(*)` and `MIN(created_at)` over undelivered `outbox` rows | **Backlog**, not delivery lag: the harness never starts the dispatcher |

## What it does not measure

The report carries an `unmeasured` list with a reason attached to every signal it cannot see, so a
reader cannot mistake absence for zero:

- **outbox delivery lag** — the Node dispatcher is not started; pending rows measure backlog.
- **AI queue wait and job age** — the Node local runtime has no configured provider or model-job
  queue. That lifecycle exists only in the Cloudflare Room, so it stays unverified locally.
- **reservation and queue rejections** — no provider reservation path is exercised.
- **reconnect count** — no WebSocket session is opened by this direct-authority harness.
- **hosted capacity** — in-memory PGlite in one process is not D1, Room SQLite, Billing or a
  Cloudflare isolate.

## Comparing two captures

`--compare <path>` prints deltas only when the two captures describe the same measurement. It
refuses, with the differing fields listed, when any of these change:

`sourceFilesSha256`, `nodeVersion`, `pgliteVersion`, `platform`, `architecture`, `rooms`,
`samples`, `staleSamples`, `hotRoomCommits`, `records`.

A refusal is the correct result. Comparing a run after a source change, a Node upgrade, or a
different workload produces a number that looks meaningful and is not.

## Commands

```powershell
# Default capture: 2 rooms, 6 timed actions and 3 stale attempts each, 12 extra hot-room commits
node --import tsx scripts/architecture-load.ts

# Compare against an earlier capture (deltas only when comparable)
node --import tsx scripts/architecture-load.ts --compare test-results/architecture-load/<capture>.json

# Bounds and defaults
node --import tsx scripts/architecture-load.ts --help
```

Defaults: `--rooms 2`, `--samples 6`, `--stale-samples 3`, `--hot-room-commits 12`,
`--records 20`, `--points 4`. Bounds are 1–6 rooms, 1–200 samples per group, 1–60 hot-room
commits, 1–8 storage points and 1–100 records; out-of-range values are rejected by both the CLI
and a direct API call.

Output goes to `test-results/architecture-load/architecture-load-<timestamp>-<script sha>.json`,
written with an exclusive create so an existing capture is never overwritten. The report contains
provenance (commit, script and source digests, Node/PGlite versions, dirty flag) and no workspace,
session or command identifiers.

## Observed reference capture (24 October 2026)

Windows x64, Node `v22.23.2`, PGlite `0.5.10`, 2 rooms, 6 samples and 3 stale attempts per room,
12 hot-room commits, 20 records, 4 storage points, worktree dirty during development.

| Room | Commits | Success p50 / p95 | Stale p50 / p95 |
| --- | --- | --- | --- |
| room 1 (hot) | 18 | 4.830 / 6.308 ms | 2.075 / 2.259 ms |
| room 2 | 6 | 4.636 / 4.895 ms | 1.775 / 2.146 ms |

Hot-room successful actions: p50 4.498 ms, p95 5.174 ms over 12 commits.

Storage curve (relation bytes): 622,592 at 12 commits → 655,360 at 15 → 679,936 at 18 →
737,280 at 21 → 761,856 at 24.

Outbox after 24 commits: 34 pending, 0 delivered, oldest pending 218 ms — a backlog because no
dispatcher ran, exactly as labelled in the report.

The raw capture lives under the ignored `test-results/architecture-load/` and is not committed. Its
source fingerprint belongs to that one worktree state, so it is an anchor for the comparability
rule, not a baseline every future run must match.

This capture is not a performance budget, an SLO, or evidence about any hosted environment. It is
one host's measurement of the local authority and SQL adapter under a fixed synthetic workload.

## Verification

```powershell
npx vitest run server/architecture-load.test.ts
npx vitest run server/architecture-baseline.test.ts
node --import tsx scripts/architecture-load.ts
npm run typecheck
npm run lint
node scripts/check-public-files.mjs
```
