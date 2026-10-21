# C — Two-phase generation spike (design + measured sizes)

**Status:** experiment / paper spike. No production code was changed.
**Measured:** 2026-10-21, Node 22.23.2, from the current working tree (`feat/F029-success-corpus`).

## 1. What we measured

`node --import tsx experiments/two-phase/measure.mjs` — numbers from the real zod schemas and the captured prompt:

| Artifact | Chars | Notes |
| --- | ---: | --- |
| Full change JSON Schema (current prompt) | 35,968 | 76% of the 47,149-char system prompt |
| Core change schema **without** canvas | 13,965 | collections/fields/actions/records only |
| Canvas schema alone (views) | 26,768 | scene + chart + metric + controls + expressions |
| View descriptor schema alone | 26,590 | nearly all of the canvas schema |
| Current rules + examples | 11,181 | 25 rule paragraphs + one example |
| — of which canvas-related rule lines | 5,744 | 12 of 27 source lines |
| — core-only rules (estimated) | 5,437 | |

Request bodies (real serializer shape, no network):

| Case | Bytes |
| --- | ---: |
| Current, empty table | 54,040 |
| Current, evolve cafe program | 58,700 |
| Phase 1 prototype prompt + core schema, empty table | 21,442 |
| Phase 2 prototype prompt + canvas schema, program context | 34,996 |

Prototype prompt files (`prompts/phase1-core.md`, `prompts/phase2-views.md`) measured with their schemas:

| | System chars | ~tokens | Body bytes | Headroom under 64,000 |
| --- | ---: | ---: | ---: | ---: |
| Current single call | 47,149 | ~13,500 | 54,040 | **9,960** |
| Phase 1 (core) | 18,355 | ~5,200 | 21,442 | **42,558** |
| Phase 2 (views) | 29,847 | ~8,500 | 34,996 | 29,004 |

## 2. Proposal

**Phase 1 — core program (always):**
- Input: user prompt, ≤4 sources, current program/records/turn, repair issues.
- Output: `{kind:"table", program:{version,title,description,collections,actions,invariants,turnOrder,evidence,assumptions}, initialRecords:{}}` — no `canvas`.
- System prompt: core rules (~5.4k chars) + core schema (13,965 chars) ≈ **19.4k chars**.
- Headroom under the 64,000-byte cap: **~40 KB for sources/records** (today: ~9.9 KB).

**Phase 2 — views (only when the table is usable):**
- Input: the accepted phase-1 program (or the validated draft), a bounded records sample, the original request, view repair issues.
- Output: `{version:1, views:[...]}` only.
- System prompt: canvas rules (~5.7k) + canvas schema (26,768) ≈ **32.5k chars**.
- Headroom for the program + records sample: ~28 KB.
- If phase 2 fails: the table still activates without views (the UI already tolerates a missing canvas; today a semantically invalid view rejects the *whole* draft — F023 only salvages schema errors).

**Repair model per phase:** 2–3 attempts each, with the same issue → simplify → minimal fallback ladder. Phase 2 repairs never resend the whole table.

## 3. Why this is attractive (evidence)

- Sources are the real constraint: a 10,000-byte source already fails today (`MODEL_PROVIDER_INPUT_TOO_LARGE`) because the prompt takes 54 KB of the 64 KB body.
- The canvas schema is 26.8k of the 36k schema — it is paid on every attempt even for data-only tables.
- Per-view failures currently kill the draft at semantic validation; two-phase makes "table first, visuals later" a real product state.
- Phase 2 can be skipped for non-visual requests, saving one call.
- **The 25s deadline is the next constraint after the budget is fixed.** In the 10 KB cap probe with the compact guide, attempt 1 took 16.5s, the repair had 8.5s, and the case died on `MODEL_PROVIDER_TIMEOUT` — while the plan's own latency target is P95 ≤45s. Two-phase lets the table activate from phase 1 and defers visuals instead of timing out the whole request.

## 4. Costs and risks

| Risk | Detail | Mitigation |
| --- | --- | --- |
| Latency | 2 sequential calls; each may repair | Phase 2 runs after the table is usable; "first useful preview" = phase 1. Budget: phase 1 ≤20s, phase 2 ≤20s. |
| Coherence | Views must reference phase-1 collection/action ids | Existing validation already checks ids; phase 2 input is the exact program, not a summary. |
| Prompt drift | Two prompts to version | Version both with one `promptVersion` id; eval each phase separately. |
| Billing/consent | Two attempts to meter | Reuse reserve/dispatch per attempt (already per-attempt) with a phase tag. |
| UX | "Table ready, visuals failed" state | Show a small notice (F023 already deferred a "skipped views" notice). |
| Total context | Phase 2 sends the program + sample rows | Cap sample rows (e.g. 20) and strip unmapped fields. |

## 5. Cheaper intermediate (recommended first)

**Conditional canvas schema:** keep one call, but append the canvas schema + rules only when the request/plan mentions visuals (chart, scene, slider, simulation, canvas, ภาพ, กราฟ). This alone removes 26.8k chars (57% of the prompt) for data-only tables and lifts the source cap from ~9.9 KB to ~36 KB, with no extra call and no new state machine. It needs a deterministic trigger (keyword/intent classifier) and must fall back to including canvas when unsure.

Two-phase remains the right end state; conditional canvas is the low-risk step that can be measured on the same corpus.

## 6. Experiment plan (next)

1. Build both prompt variants as copies (not production), measure exact bodies with the A harness (`--dry`).
2. Run the same 20-case corpus with: current, conditional canvas, two-phase (phase 1 only + phase 2). Record: table activation rate, first-attempt rate, views present/valid, rejects with issue taxonomy, P50/P95, tokens/cost.
3. Pass criteria: source-heavy cases activate ≥80% (currently blocked by the cap); no core-case regression; P95 first useful preview ≤45s (plan target).
4. Only then write a feature doc and touch production code.

## 7. Prototype prompts

Drafts live in `prompts/phase1-core.md` and `prompts/phase2-views.md`. They are deliberately short and are **not** production text; they must be reviewed against the 18 prompt-fragment assertions in `deepseek-changes.test.ts` before adoption.
