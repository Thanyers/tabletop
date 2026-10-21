# Prompt budget and schema slimming - experiment report

Scope: `D:\Project\project-procedural\experiments\variants` only. Nothing under `tabletop-dev` was modified, staged, or committed. No live model call was made; every number below comes from the provider's own serializer with a recording `fetch`.

## 1. Headline numbers

| Metric | Current | Compact variant B | Change |
| --- | --- | --- | --- |
| System prompt | 47,149 chars | 16,309 chars | -30,840 (-65.4%) |
| JSON Schema block | 35,968 chars | 5,090 chars (guide) | -30,878 (-85.9%) |
| Empty-table request body | 54,040 bytes | 17,203 bytes | -36,837 (-68.2%) |
| Headroom under 64,000 | 9,960 bytes | 46,797 bytes | +36,837 |
| Max source, 1 file | **9,895 bytes** | **32,768 bytes** | 3.31x (per-file cap) |
| Max source, 2 files (total) | 9,829 bytes | 46,666 bytes | 4.75x |
| Max source, 1 file + program + records | 5,017 bytes | 32,768 bytes | 6.53x |
| Max source, 2 files + program + records | 4,951 bytes | 41,788 bytes | 8.44x |
| Model calls per draft | 1 | 1 | unchanged |

The context claim is reproduced exactly: an ASCII source of **10,000 bytes** produces a **64,105-byte** body, 105 bytes over the cap, and is rejected with `MODEL_PROVIDER_INPUT_TOO_LARGE`. The measured effective maximum for one source with no program is **9,895 bytes**.

## 2. Method and verification

- The system prompt and request bodies are captured by constructing `DeepSeekChangeProvider` with a recording `fetch`; `propose()` throws on the canned reply but the serialized body is already captured. No network call is possible (no API key, canned `Response`).
- Exact bytes come from `measureDeepSeekChangeRequest` where the input is accepted. For over-cap inputs that function throws before sending, so bytes are computed from a segment model (`prefix + JSON.stringify(system) + between + JSON.stringify(user) + suffix`) derived from the captured body. The model reproduces the captured body byte-for-byte and matches `measureDeepSeekChangeRequest` on every accepted sweep row (0 mismatches), so the rejected rows are not estimates of a different formula.
- Private constants (`MAX_TABLE_INPUT_BYTES`, `MAX_TABLE_OUTPUT_TOKENS`, `TABLE_FILE_BYTES`) are re-read from the source text and asserted, so the script fails loudly if they drift; the 4-source cap is checked behaviourally (five sources are rejected as `MODEL_PROVIDER_INPUT_INVALID`).
- Records are real: `tableRecordsSchema.safeParse` accepts the cafe fixture (3 rows), so the "program + records" rows are a valid request shape, not a guess.
- Results: `budget.mjs` 13/13 PASS, `build-prompt.mjs` 11/11 PASS, `coverage.mjs` 64/64 PASS.

## 3. What the measurements show

### 3.1 The prompt is the problem, and JSON escaping makes it worse

With an empty table the body is 54,040 bytes: envelope 221 (0.41%), system content 53,681 (99.34%), user content 138 (0.26%). The 47,149-char prompt becomes **53,681 bytes** inside the body because every `"` costs an extra byte; the 35,968-char schema alone becomes **42,118 bytes**. Anyone estimating with character counts underestimates the schema's cost by ~6 KB.

### 3.2 Source budget is 9,895 bytes, not 9,960

The 9,960 "headroom" is the body cap minus an empty request. A real source needs the `sources` skeleton (id, filename, text keys, ~53-65 bytes), so the last accepted size is 9,895 bytes; 9,896 fails. Thai text costs 3 UTF-8 bytes per character, so the practical limit is **~3,298 Thai characters** today and **~10,922** with the compact guide.

### 3.3 Records and program consume the same budget

Program + 3 valid rows cost 4,008 user-JSON bytes before any source, which drops the one-file source limit to 5,017 bytes. Rows cost ~81 bytes each: 59 extra rows add 4,770 bytes. The 48,000-byte `MAX_TABLE_INPUT_BYTES` limit was never reached in these sweeps (max user JSON 37,073), but it is the next ceiling once the body cap stops binding.

### 3.4 The compact guide clears the cap with room to spare

- Guide: 5,090 chars, under the 8,000 target.
- A structurally exact hand-written JSON Schema cannot reach the target: it minifies to **17,294 chars** (52% smaller) because 40 discriminated branches repeat the same boilerplate and the schema carries 115 strict-object markers and 48 `maxItems` keywords. The guide reaches 5,090 by stating those conventions once.
- New binding limits, in order: per-file `TABLE_FILE_BYTES` (32,768) for one file, then `MAX_TABLE_INPUT_BYTES` (48,000 user bytes) and `MAX_CHANGE_REQUEST_BYTES` (64,000 body) for multi-file requests. The 2-file variant stops at 46,666 bytes because the body cap still binds; raising the body cap after compaction would buy only ~1.1 KB before the 48,000 input limit takes over.

## 4. Options ranked

| Rank | Option | System chars | Max source (1 file / 2 files) | Measured request body (empty table) | Main cost/risk | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Compact schema guide** (replace the 35,968-char schema with the 5,090-char guide) | 16,309 | 32,768 / 46,666 | 17,203 | Draft quality is unproven; the guide is lossy | Prompt change only; validator untouched |
| 2 | **Raise the cap** (`MAX_CHANGE_REQUEST_BYTES` 64,000 -> ~87,000) | 47,149 | 32,768 / ~32,850 (body-bound) | 54,040 | Only works if 64,000 is self-imposed rather than a provider/contract limit; larger worst-case request cost and latency; two 32 KiB files additionally need `MAX_TABLE_INPUT_BYTES` ~66,000 and a ~120,000 body cap | One constant (plus two if 2x32 KiB is required) |
| 3 | **Two-phase** (program/actions first, canvas second) | 25,146 then 33,394 | <= 32,768 (phase 1 body 28,329) | 28,329 + 37,879 | Two calls per draft: ~2x latency and cost, partial-state and repair complexity, interacts with F023 canvas salvage; still bigger than the compact single call | Large: route, state, validation, UI |

Why this order:

1. **Compact guide** is the only option that shrinks the request for every draft, keeps one call, and leaves the validator and data model untouched. It converts the source limit from 9.9 KB to the per-file 32 KiB ceiling, with 46,797 bytes of headroom left for records and program. Its risk is purely model quality, which is exactly what a live A/B can measure.
2. **Raise cap** is cheap and has no quality risk, but it does not reduce the 47 KB prompt, so only requests with attachments benefit, and the worst-case request cost grows with the cap. One 32 KiB file needs a cap of 86,873; reaching the 48,000-byte input limit with two files needs ~102,000; two 32 KiB files need ~120,000 plus `MAX_TABLE_INPUT_BYTES` ~66,000. It is only viable if 64,000 is self-imposed, and it raises the per-request cost ceiling rather than reducing per-request work.
3. **Two-phase** does not solve the input problem on its own: phase 2 is still 33,394 system chars, and a draft now costs two calls. It only makes sense if the compact guide regresses canvas quality and splitting lets each phase use a smaller, purpose-built schema.

A combined "compact + cap raise" is the strongest end state if attachments larger than 32 KiB matter: compaction makes the 48,000-byte input limit the binding one, so the cap raise would only buy the final ~1.1 KB for two files. It is not needed to fix the reported failure.

## 5. Risks

**Prompt/quality risks (the real risk surface):**

1. **Lossy strictness.** One global "every object rejects unknown keys" sentence replaces 115 per-object `additionalProperties:false` markers. Extra keys are caught by zod, so the cost is repair rounds, not bad data - but repair rounds are user-visible latency and extra calls.
2. **Coarse bounds.** Per-key `maxLength`/`maxItems` become global prose. A model can emit a 600-char label or 40 select options and only learn from a repair.
3. **Discriminator literals.** `kind`/`op`/`shape` are shown as grammar (`kind:"scene"`), not as `const` branches; a model may omit or mistype one.
4. **Shared definitions.** ID/VALUE/EXPR/OPERAND are defined once. Applying them inconsistently across 17 expression ops is the most likely failure mode.
5. **Canvas quality.** The guide preserves the four view kinds, five primitives, five controls, drag bindings and all 17 ops, but it is less explicit about each branch. The A/B must judge view quality, not just schema validity.
6. **Unchanged risk:** expression depth (32) and node (512) limits are not stated in either prompt; arrays (200) and the 6/12/16/8/12 limits are stated only as prose in the compact guide.
7. **Prompt cache cold start.** Changing the system prompt invalidates the provider prompt cache once. Token/latency measurements taken immediately after the switch will look worse; warm up or measure steady state.

**Operational risks:**

8. **10,000-byte claims are ASCII.** Quoted JSON/CSV text and newlines cost up to 2 bytes per character, and Thai costs 3; a "10 KB" file can already exceed the budget today even below 9,895 bytes of raw file length.
9. **`MAX_TABLE_INPUT_BYTES` (48,000) and `TABLE_FILE_BYTES` (32,768) remain after compaction.** The compact variant does not raise them; multi-file and very large-file cases still need a decision.
10. **Provider cap provenance.** If 64,000 is a contractual/provider limit, option 2 is unavailable and should not be attempted. This experiment did not verify it against provider documentation.
11. **Cost model.** A smaller system prompt reduces input tokens on every draft; a larger cap raises worst-case spend. The two effects are independent and should be reported separately.

## 6. What a live A/B must prove before adoption

The A/B must compare the current prompt and variant B with everything else fixed (same model, `thinking: disabled`, `response_format: json_object`, `max_tokens: 8192`, same server build, same corpus, same room fixtures) and log only codes, sizes and token counts - never source text, prompts or keys.

**Corpus:** `tests/corpus/table-prompts.json` (5 draft cases, 5 clarify cases) plus the four fixture scenarios (`cafeQueueChange`, `lightShadowChange`, `cooperativeWaterChange`, `loanAmortizationChange`) as edit/evolve cases, plus one 9,500-byte ASCII source, one 10,000-byte source (today's failure) and one 32,768-byte source case. Minimum 10 runs per case per arm (>= 200 calls for the corpus alone); report per-case results, not only the aggregate.

**Must hold (primary, blocking):**

1. **First-attempt valid draft rate** (output passes `tableChangeSchema` and `applyTableChange` without repair) is not worse than the current prompt by more than 5 percentage points, with the 95% interval excluding a larger drop.
2. **Clarify behaviour is unchanged:** all five clarify cases still clarify (vague, sheets, injection, toomany, email), and the language check still passes; no extra clarifies on the five draft cases.
3. **No increase in `MODEL_PROVIDER_OUTPUT_REJECTED`**, and the repair-attempt rate does not rise by more than 5 percentage points.
4. **Canvas salvage (F023) is not relied on more:** the share of drafts where views are dropped must not increase; all four view kinds still appear where requested.
5. **Edit semantics hold:** evolve cases keep `initialRecords: {}`, preserve rows, field definitions, invariants, view ids and the current turn (no `TABLE_PRESERVE_DATA`/`TABLE_PRESERVE_TURN` failures).
6. **Evidence grounding holds:** sourced drafts cite the real source id and an exact contiguous quote (no `TABLE_EVIDENCE` failures).
7. **The reported bug is fixed end to end:** the 10,000-byte source case completes through the real route with a draft or clarify instead of `MODEL_PROVIDER_INPUT_TOO_LARGE`; a 32 KiB file also completes at the per-file cap.

**Must hold (secondary):**

8. Prompt tokens per request drop by the measured ~30,840 characters (roughly 7-8K tokens, ~65%) and completion tokens are not worse; p95 latency is not worse by more than 10%; cost per successful draft drops.
9. A manual review of ~20 drafts (score scene/chart/metric/controls usefulness and connectedness) shows no visible quality regression; include at least one simulation, one data app and one edit.
10. Run the corpus twice on different days to catch variance; adopt only if both runs pass all primary criteria.

**Rollback:** `systemPrompt('table')` is a pure function of the kind, so the variant can sit behind a request-scoped flag with no schema, validator or data migration. Adoption is a one-line switch and rollback is the same switch.

## 7. What this experiment did not do

- No live model calls, so no claim is made that the compact guide produces valid drafts as often as the current prompt.
- The provider's 64,000-byte limit was not verified against provider documentation; it is treated as given.
- The two-phase numbers are size estimates that keep the current prose and only split the schema; they are indicative, not a designed two-phase prompt.
- No server code, tests, fixtures or git state under `tabletop-dev` were changed.

### Environment note

- During this run another process changed files under `tabletop-dev` (`CHANGELOG.md`, `PLAN.md`, `docs/features/F029-golden-corpus.md`, `tests/corpus/table-prompts.json`, `server/corpus-success-rate.test.ts` at 20:31). This experiment only writes under `experiments/variants`: every `writeFileSync`/`mkdirSync` target in `budget.mjs`, `build-prompt.mjs` and `coverage.mjs` resolves there, and `two-phase-estimate.mjs` writes nothing. The corpus was re-read after the external change: 10 cases, 5 draft and 5 clarify, matching section 6.
- Two files in `experiments/variants` (`build-variant-provider.mjs`, `provider-compact.ts`, created 20:38) were not produced by this experiment and were left untouched. `provider-compact.ts` embeds the 5,041-char guide from before the evidence-entry line was added; the final guide is 5,090 chars, so that file is stale relative to `compact-schema/schema.guide.txt`.

## 8. Files and reproduction

```
experiments/variants/
  budget.mjs                              exact body sizes, max source search, writes out/budget.{md,json}
  two-phase-estimate.mjs                  schema-split size estimate for the two-phase option (no network)
  out/budget.md, out/budget.json
  compact-schema/
    schema.guide.txt                      the 5,090-char prompt artifact
    schema.lossless-strict.json           hand-written strict JSON Schema (17,294 chars minified), measured baseline
    build-prompt.mjs                      captures both prompts, writes out/current-prompt.txt, out/variant-prompt.txt,
                                          out/variant-prompt-reworded.txt, out/measurements.json, out/size-comparison.md
    coverage.mjs                          64-item checklist against the live zod schema, writes out/coverage.{txt,json}
    out/
  REPORT.md
```

Reproduce from `D:\Project\project-procedural\tabletop-dev`:

```
node --import tsx D:\Project\project-procedural\experiments\variants\budget.mjs
node --import tsx D:\Project\project-procedural\experiments\variants\compact-schema\build-prompt.mjs
node --import tsx D:\Project\project-procedural\experiments\variants\compact-schema\coverage.mjs
node --import tsx D:\Project\project-procedural\experiments\variants\two-phase-estimate.mjs
```

`coverage.mjs` exits non-zero if any checklist item fails; all scripts currently pass (13/13, 11/11, 64/64).
