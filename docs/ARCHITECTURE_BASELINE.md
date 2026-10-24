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

The metadata records the committed source SHA, a SHA-256 of the exact benchmark script bytes, and a second SHA-256 over a deterministic framed sequence of sorted repository-relative paths and file bytes. `sourceFileCount` reports the number of inputs; `sourceFilesScope` identifies the fixed selection: tracked and non-ignored untracked `.ts`/`.tsx` under `src/tabletop` and `server` (excluding credential-named files, declaration files, generated output, and vendored source directories), the baseline script, and `package.json` plus `package-lock.json`. The report contains only the count, fixed scope label, and digest, never source contents or the selected path list. The worktree dirty flag remains useful for review, while the combined source-file digest identifies in-scope uncommitted changes. For comparisons, keep workload counts, the source-file digest, Node/PGlite versions, and host environment aligned.

## Baseline capture

Default capture on 2026-10-24 used 100 records, 40 successful actions, and 20 stale actions. On Node `v22.23.2` / PGlite `0.5.10` / Windows x64, successful `table.act` measured p50 **5.6215 ms** and p95 **6.6053 ms**; stale-revision actions measured p50 **1.8672 ms** and p95 **2.5511 ms**. Every stale sample returned `STALE_REVISION`.

The resulting storage snapshot was: `workspaces` 1 row / 286,720 bytes; `snapshots` 46 / 286,720 bytes; `events` 45 / 122,880 bytes; `commands` 45 / 286,720 bytes; `outbox` 45 / 49,152 bytes; `model_jobs` 0 / 24,576 bytes. The raw result also contains all 60 action timing samples and the five setup-command durations.

The capture identifies source commit `054acd2423d154fca45cbd71711abebb22572daf`, exact candidate script SHA-256 `bf623d32f21f3146fadb7a88e970a705566405c8d08b1700dee3f0f0a7dbcac1`, and in-scope source fingerprint `9b91bcfa6d7516d3585e9e3772ab51766b00f5b8e28533658466339664e223a7` over 248 files. The worktree was dirty because this feature was still being authored; the source-file digest identifies the exact selected file contents without publishing their contents or paths. The raw JSON stays ignored at `test-results/architecture-baseline/architecture-baseline-2026-10-24T07-13-36-338Z-bf623d32f21f.json` and is not committed. This is a single host-specific reference capture, not a performance budget; compare repeated runs with the same source fingerprint and runtime before drawing conclusions. The accepted capture and verification are recorded in [F078-T2](features/F078-T2-architecture-baseline.md).

## Focused verification

```powershell
node node_modules/vitest/vitest.mjs run server/architecture-baseline.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions --types node scripts/architecture-baseline.ts server/architecture-baseline.test.ts
node node_modules/eslint/bin/eslint.js scripts/architecture-baseline.ts server/architecture-baseline.test.ts
npm run typecheck
npm run lint
node scripts/check-public-files.mjs
```

The integration test runs the workload against in-memory PGlite, checks both latency groups, verifies that stale failures add no committed rows, and confirms that repeated runs with unchanged inputs produce the same source fingerprint. Other tests confirm that no-flag parsing returns the documented defaults, accept the 100-row cap, reject 101 both in CLI parsing and runtime validation, and use disposable Windows junctions to verify output cannot escape the ignored result directory. The focused tests, script typecheck, scoped lint, repository typecheck, CLI baseline, and public-file scan passed for F078-T2. Repository lint completed with 0 errors and 111 warnings; the new files had no lint findings.
