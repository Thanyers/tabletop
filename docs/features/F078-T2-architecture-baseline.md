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

The CLI creates one collection and bounds records to the shared per-collection table limit (100 rows); each timing group is limited to 500 samples. It saves raw millisecond samples, nearest-rank p50/p95 summaries, setup-command timings, per-table row counts and `pg_total_relation_size` bytes, and Node/platform/architecture/PGlite/source metadata under the ignored `test-results/architecture-baseline/` directory. Provenance includes the source commit, exact script digest, and a deterministic framed digest/count over tracked and non-ignored untracked `.ts`/`.tsx` under `src/tabletop` and `server` (excluding credential-named files, declarations, generated output, and vendored sources), the baseline script, and the package manifests. Only the digest, count, and fixed scope are reported; source contents and selected paths are omitted. The output also omits workspace, session, and command IDs. The in-memory database closes in `finally` on both success and failure.

## Ownership

new scripts/architecture-baseline.ts and tests; docs/ARCHITECTURE_BASELINE.md

## Baseline capture

Captured 2026-10-24 with 100 synthetic records, 40 successful commands, and 20 stale-revision commands. Environment: Node `v22.23.2`, Windows x64, PGlite `0.5.10`, in-memory database. The committed source was `054acd2423d154fca45cbd71711abebb22572daf`; the worktree was dirty during authoring. The exact candidate script is identified by SHA-256 `bf623d32f21f3146fadb7a88e970a705566405c8d08b1700dee3f0f0a7dbcac1`; its 248-file source fingerprint is `9b91bcfa6d7516d3585e9e3772ab51766b00f5b8e28533658466339664e223a7`.

| Measurement | Count | p50 | p95 |
| --- | ---: | ---: | ---: |
| Successful `table.act` | 40 | 5.6215 ms | 6.6053 ms |
| Stale `table.act` (`STALE_REVISION`) | 20 | 1.8672 ms | 2.5511 ms |

Storage after setup and successful commands:

| Relation | Rows | Relation bytes |
| --- | ---: | ---: |
| `workspaces` | 1 | 286,720 |
| `snapshots` | 46 | 286,720 |
| `events` | 45 | 122,880 |
| `commands` receipts | 45 | 286,720 |
| `outbox` pending rows | 45 | 49,152 |
| `model_jobs` | 0 | 24,576 |

Bytes are PostgreSQL relation bytes, including table, indexes, and TOAST storage. They do not measure process memory or persistent disk use. The direct-authority harness does not dispatch outbox entries, so those rows remain pending. The raw report is `test-results/architecture-baseline/architecture-baseline-2026-10-24T07-13-36-338Z-bf623d32f21f.json` and is ignored by Git. This is one host-specific capture, not a performance budget; use repeated runs with aligned source fingerprint and runtime for comparisons.

## Verification

- `node node_modules/vitest/vitest.mjs run server/architecture-baseline.test.ts` — 1 file, 4 tests passed, including the default options, deterministic source fingerprint, 100-row option boundary, and junction-safe output-path checks.
- `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --strict --skipLibCheck --allowImportingTsExtensions --types node scripts/architecture-baseline.ts server/architecture-baseline.test.ts` — passed.
- `npm run typecheck` — passed.
- `node node_modules/eslint/bin/eslint.js scripts/architecture-baseline.ts server/architecture-baseline.test.ts` — passed with no findings.
- `npm run lint` — 0 errors and 111 repository warnings; the new script and test have no lint findings.
- `node scripts/check-public-files.mjs` — scanned 809 files, 0 findings.
- `node --import tsx scripts/architecture-baseline.ts --records 100 --samples 40 --stale-samples 20` — passed with the source fingerprint above; wrote the ignored raw report above.

No production release or deployment is part of this task.
