# F078-T3 — Risk-targeted pre-merge integration gates

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — development verification; existing behavior |

## ทำไม

Architecture improvement task authorized on 2026-10-24. Establish evidence before refactoring.

## ขอบเขต

Boot the actual Worker artifact for relevant PRs before merge; preserve existing full-suite requirements and security/fixture behavior. Do not edit tests/cloudflare-browser.mjs (open PR #250).

## Ownership

new scripts/integration-gate*.mjs; validate.yml; gate tests/docs

## Acceptance

- [x] Changed-path planning compares the explicit PR base/head SHAs, includes deletions and both names of renames, and fails closed when commit/diff retrieval fails.
- [x] Relevant Worker paths boot the built artifact with synthetic local bindings and migrations, then check health, readiness, and capabilities.
- [x] Composer/reference changes select the F066 browser harness; compute changes select focused shared/domain/UI/server and Cloudflare compute tests; Dockerfile changes also select the Container API smoke.
- [x] Existing full-suite triggers and the `main` result-reuse logic remain in place; no production code or credential configuration changed.

## Verification record

- Environment: Node `v22.23.2`, npm `11.0.0`, Windows local worktree.
- `npm ci`: passed; npm reported 7 advisories on this base. The separate F078-T0 dependency fix owns those findings; this task did not edit package metadata or the lockfile.
- `node --test scripts/integration-gate-plan.test.mjs scripts/integration-gate-worker-startup.test.mjs`: 13/13 passed, including malformed-module rejection and the unknown-path default.
- Focused compute Vitest selection: 54/54 tests across 11 files; Cloudflare compute-runner selection: 7/7.
- F066 browser harness: passed; no page errors and no horizontal overflow at 280, 320, 390, and 414 px.
- `npm run build`: passed; public demo check and all three TypeScript projects passed before Vite build.
- `npm run build:cloudflare`: passed with Wrangler dry-run; no publish or deploy.
- `node scripts/integration-gate-worker-startup.mjs`: passed against the built artifact; `/healthz`, `/readyz`, and `/api/capabilities` returned successfully, with model disabled and local migrations applied.
- Planner CLI: the reserved base and head resolved and produced the expected documentation-only selection; a missing base commit exited nonzero with a fail-closed error.
- The workflow YAML parsed locally, but no GitHub Actions run was started from this worktree. The Workers Container API smoke is Linux-only in its existing script and was not run on this Windows host; it is selected in CI only when a `compute/` file changes.
- Branch HEAD at verification: `b6b4f3048974de7d1f11c1c3602c4a87aa1ce962`; implementation remained uncommitted in this worktree as requested. Parent integration must record the resulting candidate commit SHA before review. No production release.
