# F078 — Architecture improvements with preserved behavior

| | |
| --- | --- |
| สถานะ | `doing` (T0–T4 + T3a merged; T5a–T9 in progress, one PR each) |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — documentation, validation and internal refactors; evaluate each task separately |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F078-T*` |

## ทำไม

Current behavior spans several contract documents and broad UI/Room orchestration modules. Changes need stronger checks across the rendered client, authority and persistence adapters before internal refactoring. Long-lived rooms also need a measured storage and execution baseline.

## สิ่งที่ผู้ใช้จะเห็น

The existing workflows remain the acceptance baseline. This work targets clearer maintenance contracts and regression detection. The user authorized development and separate PRs on 2026-10-24, with no production release.

## ขอบเขต

รวม: current architecture map, reproducible local measurements, targeted integration gates, shared persistence conformance, incremental internal extraction, storage/recovery design and typed view registration when prerequisites are met.

ไม่รวม: changing visibility/consent/auto-apply/billing policy, new product behavior, production release, persistent schema changes, deleting/compacting saved data or restoring a shared database. Storage mutations require a separate exact scope and approval.

## ข้อเท็จจริงจากโค้ด

Baseline inspected on 2026-10-24: dev `9efebab0c4c9`. `CommandAuthority` shares deterministic domain rules between SQL and Room adapters. Compute uses an injected runner and revision-bound results. `VISIBILITY_POLICY` is open; money caps are deliberately disabled; consent covers an actor/table epoch and later files. No-file creation and later file attachment are already implemented.

## งาน

| ID | Separate PR scope | Prerequisite | Acceptance |
| --- | --- | --- | --- |
| T0 | Compatible security patches unblock existing dependency validation | — | Clean install, audit, existing unit/Worker/build checks; separate PR #264 |
| T1 | [PR #260](https://github.com/Thanyers/tabletop/pull/260): Current contract, capability map and this sequence | — | Source-linked policies and runtime differences agree; document links/public scan pass |
| T2 | [PR #261](https://github.com/Thanyers/tabletop/pull/261): Disposable local authority/storage/performance baseline | — | Repeatable bounded synthetic workload, raw samples + summary, source/environment labels, no shared/remote writes |
| T3 | [PR #262](https://github.com/Thanyers/tabletop/pull/262): Risk-targeted pre-merge integration gates | T1 | Real Worker startup checked before merge; selection has negative fixtures and preserves full-suite requirements |
| T4 | [PR #263](https://github.com/Thanyers/tabletop/pull/263): Shared repository conformance scenarios | T1 | Same duplicate/CAS/atomicity cases run against SQL and Room adapters without changing application semantics |
| T5a | Workspace command/readback extraction (`TabletopApp` → typed client seam) | T2–T4; ownership resolved | Create/file-later attach/ack/readback/same-command retry/stale-conflict/workspace switch keep current behavior; no domain mutation in UI |
| T5b | Navigation/focus lifecycle extraction (composition root keeps wiring) | T5a | URL/back/forward, create/open/switch and late async results keep current behavior; no UI redesign |
| T6a | Room job view/progress seam (server-only) | T2–T4; ownership resolved | Public status/response/redaction/visibility unchanged |
| T6b | Room job coordination seam (draft/assistant/reconcile/recovery), one path at a time | T6a | Retry/epoch/revision/revoked-member/late-result/uncertain-billing/auto-apply guards unchanged; conformance + relevant Room tests + full dev suite pass |
| T7a | Storage lifecycle and recovery contract + bounded growth measurement on disposable fixtures | T2, T4 | Every store and owner named, receipt replay horizon recorded as an open question, recovery manifest/schema/writer/epoch/revision/directory sequence/billing reconciliation described; nothing deleted |
| T7b | Disposable recovery rehearsal | T7a | Multiple revisions, revoked member, pending/uncertain jobs, exact retry after restore, state hash/cursor/receipt/billing agreement; model RPO/RTO measured with hosted-restore limits stated |
| T8 | Typed built-in Canvas view registration | T3, T5 | Compiler/tests catch a missing kind, malformed descriptors reject, valid schema→semantic→evaluation→render passes; wire contract preserved; core does not import React |
| T9 | Extended load/soak and capacity comparison | T2, T5–T7 | Success/stale latency, queue/job age, failure/reconnect/outbox lag and storage curve across rooms compared against the recorded baseline before any capacity change |

Each implementation PR owns its code and test files. Shared status documents are updated serially by the main agent. T5/T6 must check existing `doing` ownership before touching UI or Room hotspots. The first delivery group is T1–T4; subsequent tasks remain explicitly tracked with their prerequisites.

### Ownership resolution before T5/T6 (2026-10-24)

PLAN still listed `doing` rows for F037, F050-T1..T3 and F054-T9 that name the UI and Room hotspots. Checked against remote state before touching them, not assumed:

- `origin/feat/F050-live-thinking`, `origin/feat/F054-object-metadata-and-focus` and `origin/feat/objects-panel-tools` are all ancestors of `origin/dev` (`git merge-base --is-ancestor`), and no open PR carries their IDs. Their edits are already on dev; the `doing` labels are stale bookkeeping, not active work in those files.
- No `origin/feat/F037-note-cards` branch exists, and its PLAN note already records that the UI part was not started. F037 keeps its `doing` row but holds no branch or PR in the files T5a/T5b touch.
- The only open PRs are #250 (CI provider mock diagnostics, `tests/cloudflare-browser.mjs`) and #259 (F077 story docs). Neither file is touched by T5a/T5b/T6.

So T5a may change `src/tabletop/TabletopApp.tsx` and a new client module, and T6 may change `cloudflare/room.ts`, without overwriting another active change. `tests/cloudflare-browser.mjs` stays untouched while #250 is open.

## คำถามเปิด

- Required retention and receipt replay horizon are not yet decided; do not infer deletion approval.
- Unsent starting-text persistence across devices is a product behavior decision and is outside behavior-preserving refactors.
- Target room count and latency SLO should be chosen after the baseline; measured results must not be represented as hosted capacity.

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-24 | Separate PRs, preserve behavior, integrate through dev only | User authorization; no production release |
| 2026-10-24 | Measurements precede refactoring and capacity changes | Establish an honest comparison and avoid speculative infrastructure changes |

## Verification

T1 candidate: [PR #260](https://github.com/Thanyers/tabletop/pull/260). Node v22.23.2; local Markdown targets checked, changelog fragment validation and public-file scan passed; whitespace check passed. Application/unit/browser suites are SKIPPED locally because this PR changes documentation only. Required CI initially failed on the unchanged dependency tree; T0 is a separate prerequisite, not a bypass or a PASS for that attempt. Final CI evidence is recorded in spec and the PR.

### T5a — workspace command/readback seam (PR #266)

Moved out of `TabletopApp` into `src/tabletop/workspace/command-session.ts`: acknowledgement readback, `runCommand`, the legacy upload, file-later attach, web-source attach, assistant-action confirmation and the projection refresh. The module is a factory over an explicit dependency list and imports no React; the component keeps the projection state, busy marker, notices and invitation panels the seam calls back into.

Behavior that had to stay identical and is now pinned by tests: an acknowledgement is used directly only when no newer projection arrived; a duplicate acknowledgement forces a readback; a late acknowledgement never becomes the drawn projection after the member switched tables; a conflict reports once, refreshes and never resends; `STALE_LAYOUT` refreshes silently; layout writes never take the foreground busy marker; a read-only table refuses before sending; attach refuses an unsupported file or a replaced table before sending.

Node `v22.23.2`: `npm run typecheck` (three configs) passed, unit/SQL **927 passed / 5 skipped (932)** (baseline 912 + 15 seam tests), lint **0 errors / 111 warnings** (same as baseline), `npm run build` passed, public scan **830 files / 0 findings**, `changelog.ts check` 7 fragments, `git diff --check` clean. Workers and browser suites are **SKIPPED locally** for this client-only move; `src/tabletop/TabletopApp.tsx` is an explicitly uncovered path for the integration-gate planner, so the PR runs every focused gate (built Worker boot, F066 rules harness, compute checks, Linux container smoke) and the full dev run after merge covers the browser suites. No schema, retention, billing or visibility change.

Required PR CI ([run40079154319](https://github.com/Thanyers/tabletop/actions/runs/40079154319)) passed `local-validation`, fast-checks, the built Worker startup probes, the **F066 composer/reference-routing browser harness** and the focused compute tests, with the three browser suites and staging correctly skipped on a pull request. Merged into `dev` as `90c0ad0`.

### T5b — navigation/focus lifecycle (PR #268)

Moved out of `TabletopApp` into `src/tabletop/navigation/workspace-navigation.ts` as pure decisions: `pageForPath`, `pathForProjection`, `nextHistoryWrite` (returns `skip` / `replace` / `push` plus the mode the next write starts from), `signInReturnPath`, `isSameOpenTable`, `tableChangeReset` with `pendingRulesObject`, and `focusRequest` with the invoice evidence object ids. The `AppPage` type moved with them.

The component keeps every piece of React state — projection, page, selection, focus, opened card, draft prefill, rename and invitation panels — and only applies the returned decision. No route, history-entry count or visual behavior changed, and this is not a UI redesign.

One behavior is deliberately tightened, and it is called out rather than hidden: the `popstate` handler now checks `isSameOpenTable` before applying a fetched table, so a back/forward fetch that resolves after the member switched tables no longer draws the previous table under the new address. The rule that a chat-first table opens nothing until there is a rule draft to review (F006) is now a named function, and a participant is taken to the review card because F035 gives participants the owner's permissions except delete/reset — the test states that rather than assuming opposite.

Node `v22.23.2`: `npm run typecheck` (three configs) passed, unit/SQL **937 passed / 5 skipped (942)** (927 from T5a + 10 navigation tests), lint **0 errors / 111 warnings** (same as baseline), `npm run build` passed, public scan clean, `changelog.ts check` 7 fragments, `git diff --check` clean. Workers and browser suites are **SKIPPED locally**: `src/tabletop/TabletopApp.tsx` is an explicitly uncovered planner path, so the PR selects every focused gate, and the three browser suites run in the full dev run after merge. No schema, retention, billing or visibility change.

Fix (PR #272): the guard shipped as `isSameOpenTable`, which returns false when nothing is open, so the `popstate` handler dropped a Forward-navigated table and the full dev run failed at `tests/cloudflare-browser.mjs:530`. It is now `shouldApplyLateOpen`, which applies when nothing is open, when the same table is open, or when the member stayed put, and still drops a fetch for a table they navigated away from. Navigation tests cover the null/undefined/switched cases.

### T6a — Room job view/progress seam (PR #267)

Moved out of `cloudflare/room.ts` into `cloudflare/room-job-view.ts`: `PublicModelJob`, the assistant confirmation message and job views, the draft job status/view functions, `publicClarification`, and the four redaction/clamping helpers (`draftIdentityReplacements`, `boundedFailureDetails`, `boundedSearchProgress`, `boundedResearch`). The token/cursor/prompt constants move with them so there is one definition.

Every moved function is a free function with no `this`, storage, clock or alarm, and the module imports no React and no client code. The Room keeps routing, the `202`/`200` split, `ctx.waitUntil`, alarm scheduling and the open-vs-private scope selection, so a projection move cannot change when a job is polled or who may read it.

Behavior that had to stay identical: JSON body shape **and key order**, absent-vs-undefined keys, the `revoked → failed` and `committing → running` collapses, the clarified-answer and auto-apply fields, failure messages, and the redaction-before-clamp bounds. A malformed stored row still throws `INTERNAL_ERROR` rather than degrading to a default view.

Node `v22.23.2`: `npm run typecheck` (three configs) passed, Workers **204 passed / 0 failed** (unchanged from baseline, including the `room.test.ts` view/progress/redaction cases), `npm run build` passed, `npm run build:cloudflare` (Wrangler dry-run) passed, lint **0 errors** with the same three pre-existing `room.ts` warnings (`ModelProviderClosed`, `ModelRequestTimeout`, `empty`, all dead before this change and left alone to keep scope), public scan **830 files / 0 findings**, `changelog.ts check` 7 fragments, `git diff --check` clean. `cloudflare/room.ts` went from 1809 to 1489 lines with a 301-line `room-job-view.ts`. The unit/SQL suite is **SKIPPED by nature** (it covers `src/` and `server/`, neither touched) and browser suites run in the full dev run after merge. No schema, billing, retention or visibility change.

### T8 — typed built-in Canvas view registration (PR #270)

`src/tabletop/shared/view-kinds.ts` is the new leaf module: `import type` only, no zod, and plain metadata per kind (`layoutRole`, `needsRows`, `needsActions`) declared `satisfies { readonly [K in GenerativeViewDescriptor['kind']]: GenerativeViewKindMetadata }`. `GenerativeViewDescriptor` stays in `generative-contracts.ts` as the source of truth and does not import the registry, so there is no new runtime import cycle and no module-scope constant read across one (the 2026-10-23 `TABLE_AI_INPUT_BYTES` lesson).

Every layer that used to accept a missing kind now derives from that one record: the wire schema declares one `z.strictObject` per kind and builds the `z.discriminatedUnion` from them; semantic validation and canvas evaluation dispatch through per-kind maps guarded by `assertNeverViewKind`; the capability registry, the required rows/actions inputs and the manifest bindings come from per-kind records; the React renderer map stays in `ui/GeneratedCanvasObjects.tsx`, where a missing renderer is a compile error rather than a JSX fallback; `canvasLayoutRole` reads the role from the registry instead of guessing the capability leaf. The prose layers follow the registry too — the capability summary sentence and the prompt guide's `VIEW = …` line — and the guide still has to name every kind's descriptor block.

Wire contract, `GENERATIVE_LIMITS`, descriptor fields and product primitives are unchanged (every branch remains a `z.strictObject` with literal `kind` and `version: 1`). No React import enters `shared/`, `runtime/`, `domain/` or `server/`.

Controlled RED, twice, then reverted byte-identically (SHA-256 verified against the pre-probe files): (1) adding a fifth `timeline` kind to the wire union only makes `tsc` fail in 19 places, and compiling that leaf alone shows the first failure is the registry (`TS1360 … Property 'timeline' is missing`); (2) also registering it in the metadata satisfies the leaf alone, while the full program still fails in 14 places (schema, validation, evaluator, runtime index, renderer map and the typed test fixtures) and the registration tests fail 8 cases. After the revert, `npm run typecheck` and the touched suites are green again.

Node `v22.23.2`: `npm run typecheck` (three configs) passed; `npm test` **950 passed / 5 skipped (955)** after merging dev `58798fe` (dev was 938 / 5, plus the 12 registration tests); lint **0 errors / 111 warnings** (same as baseline); `npm run build` passed; `node scripts/check-public-files.mjs` **843 files / 0 findings**; `npx tsx server/changelog.ts check` 11 fragments; `git diff --check` clean. Workers and browser suites are **SKIPPED locally**: this PR touches shared, client runtime, the canvas UI and one provider prompt module, not Worker, Room, transport or persistence code.

## First delivery group status (2026-10-24)

T0/#264, T1/#260, T4/#263, T2/#261 and T3/#262 are merged into dev. T3's full dev run passed, but its staging job was SKIPPED after optional focused jobs were skipped. [T3a](F078-T3a-staging-skip.md) closes that scheduling regression before this delivery group is declared complete. All behavior-preserving refactors remain separate later tasks with their test and ownership prerequisites; none is represented as implemented by the foundation PRs. Independent review closed the baseline provenance/default assertions and the focused browser timing issue. Production release remains out of scope.

### T3a closing status (2026-10-24)

T3a/#265 merged as `d374e7051350237354d2055982cc383040c8e402`. Its dev run [40075882571](https://github.com/Thanyers/tabletop/actions/runs/40075882571) finished **success** with `Deploy tabletop-staging` **success** — the hosted deployment the scheduling fix existed for — while the three focused PR-only jobs stayed SKIPPED by design and are not counted as passes. Reading `/version` back returned staging `0.0.0-dev / d374e70` (`built_at` `2026-10-24T07:59:41Z`) and production unchanged at `9.0.2 / 8e2c7e1`. So the scheduling regression is closed by a real staging deployment, not by the overall run conclusion alone.
