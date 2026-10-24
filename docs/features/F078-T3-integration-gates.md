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

## Initial verification record (before parent integration)

- Environment: Node `v22.23.2`, npm `11.0.0`, Windows local worktree.
- `npm ci`: passed; npm reported 7 advisories on this base. The separate F078-T0 dependency fix owns those findings; this task did not edit package metadata or the lockfile.
- `node --test scripts/integration-gate-plan.test.mjs scripts/integration-gate-worker-startup.test.mjs`: 13/13 passed, including malformed-module rejection and the unknown-path default.
- Focused compute Vitest selection: 54/54 tests across 11 files; Cloudflare compute-runner selection: 7/7.
- F066 browser harness: passed normally and with a controlled delayed-prefill barrier; the latter held the old `Change this rule` value, released it, then verified the exact JavaScript prompt. Existing rule-reference and `onSend` assertions passed; no page errors or horizontal overflow at 280, 320, 390, and 414 px.
- `F066_PREFILL_RACE_MODE=red node tests/ui/f066-rules-browser.mjs`: expected nonzero result at the former immediate prompt assertion, with `observedWhileHeld: "Change this rule"`; the probe screenshot is under ignored `test-results/`, and its diagnostic text is emitted to stdout. The controlled mode distinguishes a stale read from an incorrect final prompt without sleeps or production changes.
- Diagnosis: GitHub Actions run `40073190268` / job `120810909412` read the textarea before `TableChat`'s `useEffect` applied the new prefill. The browser harness now waits on the exact textarea value before asserting it.
- `npm run build`: passed; public demo check and all three TypeScript projects passed before Vite build.
- `npm run build:cloudflare`: passed with Wrangler dry-run; no publish or deploy.
- `node scripts/integration-gate-worker-startup.mjs`: passed against the built artifact; `/healthz`, `/readyz`, and `/api/capabilities` returned successfully, with model disabled and local migrations applied.
- Planner CLI: the reserved base and head resolved and produced the expected documentation-only selection; a missing base commit exited nonzero with a fail-closed error.
- The workflow YAML parsed locally, but no GitHub Actions run was started from this worktree. The Workers Container API smoke is Linux-only in its existing script and was not run on this Windows host; it is selected for `compute/` changes and fail-safe all-gate decisions (including workflow/package changes).
- Re-verification started from branch HEAD `4a40ce30401f851a86cc63d9686deebe6c7d3a18`; the parent subsequently committed the harness follow-up in `662ff5b` and integrated prerequisites through `518044c`. No production release.

## Integrated candidate and CI evidence

The reviewed gate implementation is committed in `ab78704` and integrated with dev/dependency prerequisites through `4a40ce3`. After patched `npm ci`, the 13 gate tests and actual Worker startup probe passed again. GitHub Linux job [120810909457](https://github.com/Thanyers/tabletop/actions/runs/40073190268/job/120810909457) passed the focused compute tests, Cloudflare runner tests and selected Container API smoke.

The same CI run exposed an immediate-read race in the existing F066 fixture at the runtime-choice prompt. A query-gated manual prefill barrier reproduced the stale value in red mode; controlled release and normal browser runs passed with the exact full prompt. The browser test now awaits that exact DOM value before asserting it. Reference/onSend/navigation assertions remain, with no production UI change. Independent scoped review found no material findings. The failed CI attempt remains a failure; required validation must pass on the new candidate before merge.

Final documentation reconciliation removes duplicate F078 PLAN rows introduced by union merges. Completed tasks remain in this feature's umbrella document, spec and their PRs; PLAN retains the active gate task and later tasks according to its board rules.
