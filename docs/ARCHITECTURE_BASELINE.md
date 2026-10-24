# Disposable local authority and storage baseline

F078-T2 measures the current direct command path through `CommandAuthority`, `SqlWorkspaceRepository`, and PGlite. It uses a synthetic table program and records to establish a reproducible local reference before architecture work. It does not change production behavior, schema, or retention.

## Run

From the repository root, run:

```powershell
node --import tsx scripts/architecture-baseline.ts --records 100 --samples 40 --stale-samples 20
```

The counts are bounded: this benchmark uses one collection, so records must be between 1 and the shared per-collection table limit (currently 100); each sample group must be between 1 and 500. Omitting a flag uses the documented defaults of 100 records, 40 successful samples, and 20 stale samples. `--help` prints the current limits.

Each invocation creates a fresh `PGlite` database using the in-memory URI, applies the local schema, creates one synthetic owner and table, and activates a typed program through `CommandAuthority`. It then submits successful `table.act` commands and stale-revision `table.act` commands directly to that authority. It does not start the HTTP server or read connection settings, credentials, or a pre-existing database. No workspace, session, or command identifiers are included in the saved report.

The JSON report is written to a unique file below the ignored `test-results/architecture-baseline/` directory. The writer checks the resolved output directory stays under the repository before creating the file and refuses to overwrite an existing result. The database is closed in a `finally` block, including when setup or measurement fails. No persistent data cleanup is needed because the database is in memory.

## Measurements

The report retains the raw successful and stale action durations in milliseconds and summarizes each group with p50 and p95 using the nearest-rank percentile method. Timing starts immediately before `authority.execute` and ends when its promise resolves or rejects; envelope construction is excluded. The five rule setup command durations are retained separately and are not mixed into either action percentile.

Storage rows and `relationBytes` are sampled after the command workload. The byte values come from PostgreSQL `pg_total_relation_size` for each named relation and are exact bytes as reported by PGlite. They include the relation's table, indexes, and TOAST storage. They do not represent process memory, the full PGlite database image, WAL, or persistent disk use. Table records themselves live inside JSONB domain state and snapshots, so there is no separate records relation.

The report includes `workspaces`, `snapshots`, `events`, `commands` (idempotency receipts), `outbox`, and `model_jobs`. The outbox remains undelivered because the direct-authority benchmark does not run an HTTP dispatcher. This workload creates no model jobs. Failed stale commands are expected to return `STALE_REVISION`; they do not commit a snapshot, event, receipt, or outbox row. A different error or an accepted stale command fails the run.

The metadata records the committed source SHA, a SHA-256 of the exact benchmark script bytes, whether the worktree is dirty, Node version, platform, architecture, PGlite version, and capture time. Use the script hash to identify the candidate code when a run includes uncommitted changes. For comparisons, keep the workload counts, source, Node/PGlite versions, and host environment aligned.

## Baseline capture

Default capture on 2026-10-24 used 100 records, 40 successful actions, and 20 stale actions. On Node `v22.23.2` / PGlite `0.5.10` / Windows x64, successful `table.act` measured p50 **5.8162 ms** and p95 **6.9710 ms**; stale-revision actions measured p50 **2.2928 ms** and p95 **3.8409 ms**. Every stale sample returned `STALE_REVISION`.

The resulting storage snapshot was: `workspaces` 1 row / 286,720 bytes; `snapshots` 46 / 286,720 bytes; `events` 45 / 122,880 bytes; `commands` 45 / 286,720 bytes; `outbox` 45 / 49,152 bytes; `model_jobs` 0 / 24,576 bytes. The raw result also contains all 60 action timing samples and the five setup-command durations.

The capture identifies source commit `4889a55206ac306f7c2d6c3c8d0bda97b8df964a` and exact candidate script SHA-256 `09432df71d0431b2a3d43ed19de18ea0136fbef6ff72f5b24633e86c8f3916cf`. The worktree was dirty because this feature was still being authored; the script digest identifies the exact measured script bytes. A later CLI-cap correction set the maximum to the one collection's 100-row contract; the captured default workload was already 100 rows, so its measured workload and results are unchanged. The raw JSON stays ignored at `test-results/architecture-baseline/architecture-baseline-2026-10-24T06-56-15-684Z-09432df71d04.json` and is not committed. This is a single host-specific reference capture, not a performance budget; compare repeated runs with the same source and runtime before drawing conclusions. The accepted capture and verification are recorded in [F078-T2](features/F078-T2-architecture-baseline.md).

## Focused verification

```powershell
node node_modules/vitest/vitest.mjs run server/architecture-baseline.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions --types node scripts/architecture-baseline.ts server/architecture-baseline.test.ts
node node_modules/eslint/bin/eslint.js scripts/architecture-baseline.ts server/architecture-baseline.test.ts
npm run typecheck
npm run lint
node scripts/check-public-files.mjs
```

The integration test runs the workload against in-memory PGlite, checks both latency groups, and verifies that stale failures add no committed rows. Other tests accept the 100-row cap, reject 101 both in CLI parsing and runtime validation, and use disposable Windows junctions to verify output cannot escape the ignored result directory. The focused tests, script typecheck, scoped lint, repository typecheck, CLI smoke run, and public-file scan passed for F078-T2. Repository lint completed with 0 errors and 111 warnings; the new files had no lint findings.
