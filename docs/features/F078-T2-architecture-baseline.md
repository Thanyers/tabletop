# F078-T2 — Disposable local authority and storage baseline

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — development verification; existing behavior |

## ทำไม

Architecture improvements need a measured local reference before refactoring. This task captures the current command and storage costs without changing production behavior.

## ขอบเขตและการทำงาน

`scripts/architecture-baseline.ts` creates a fresh in-memory PGlite database, runs the existing migration, creates one synthetic table workspace, activates a typed program through `CommandAuthority`, and executes successful and stale `table.act` commands through the same authority and `SqlWorkspaceRepository` used by the local server. It does not start the HTTP server, read connection settings or credentials, or connect to an existing database. Production code, schema, and retention behavior are unchanged.

The CLI creates one collection and bounds records to the shared per-collection table limit (100 rows); each timing group is limited to 500 samples. It saves raw millisecond samples, nearest-rank p50/p95 summaries, setup-command timings, per-table row counts and `pg_total_relation_size` bytes, and Node/platform/architecture/PGlite/source metadata under the ignored `test-results/architecture-baseline/` directory. The output omits workspace, session, and command IDs. The in-memory database closes in `finally` on both success and failure.

## Ownership

new scripts/architecture-baseline.ts and tests; docs/ARCHITECTURE_BASELINE.md

## Baseline capture

Captured 2026-10-24 with 100 synthetic records, 40 successful commands, and 20 stale-revision commands. Environment: Node `v22.23.2`, Windows x64, PGlite `0.5.10`, in-memory database. The committed source was `4889a55206ac306f7c2d6c3c8d0bda97b8df964a`; the worktree was dirty during authoring, so the exact candidate script is identified by SHA-256 `09432df71d0431b2a3d43ed19de18ea0136fbef6ff72f5b24633e86c8f3916cf`. A follow-up option-bound correction limits this one collection to the same 100-row default used by the captured run; it does not change the capture workload or results.

| Measurement | Count | p50 | p95 |
| --- | ---: | ---: | ---: |
| Successful `table.act` | 40 | 5.8162 ms | 6.9710 ms |
| Stale `table.act` (`STALE_REVISION`) | 20 | 2.2928 ms | 3.8409 ms |

Storage after setup and successful commands:

| Relation | Rows | Relation bytes |
| --- | ---: | ---: |
| `workspaces` | 1 | 286,720 |
| `snapshots` | 46 | 286,720 |
| `events` | 45 | 122,880 |
| `commands` receipts | 45 | 286,720 |
| `outbox` pending rows | 45 | 49,152 |
| `model_jobs` | 0 | 24,576 |

Bytes are PostgreSQL relation bytes, including table, indexes, and TOAST storage. They do not measure process memory or persistent disk use. The direct-authority harness does not dispatch outbox entries, so those rows remain pending. The raw report is `test-results/architecture-baseline/architecture-baseline-2026-10-24T06-56-15-684Z-09432df71d04.json` and is ignored by Git. This is one host-specific capture, not a performance budget; use repeated runs with aligned source and runtime for comparisons.

## Verification

- `node node_modules/vitest/vitest.mjs run server/architecture-baseline.test.ts` — 1 file, 4 tests passed, including the 100-row option boundary and junction-safe output-path checks.
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions --types node scripts/architecture-baseline.ts server/architecture-baseline.test.ts` — passed.
- `npm run typecheck` — passed.
- `node node_modules/eslint/bin/eslint.js scripts/architecture-baseline.ts server/architecture-baseline.test.ts` — passed with no findings.
- `npm run lint` — 0 errors and 111 repository warnings; the new script and test have no lint findings.
- `node scripts/check-public-files.mjs` — scanned 809 files, 0 findings.
- `node --import tsx scripts/architecture-baseline.ts --records 1 --samples 1 --stale-samples 1` — passed after output-path hardening; wrote an ignored smoke result. The 100-record full capture above predates only the bound correction, which leaves its default workload unchanged.

No production release or deployment is part of this task.
