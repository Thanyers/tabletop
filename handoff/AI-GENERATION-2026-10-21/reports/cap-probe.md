# Source-cap probe — 10 KB attachment, current vs compact prompt

One case (`big-source-10k`, 10,010 ASCII bytes, 342 CSV rows, prompt asks for a daily sales table with a chart), run live on 2026-10-21 with the same 4-attempt/25s loop and the same validator.

| arm | outcome | attempts | requests | case ms | detail |
| --- | --- | ---: | ---: | ---: | --- |
| current prompt | **error** | 1 | **0** | 4 | rejected before any HTTP call: `MODEL_PROVIDER_INPUT_TOO_LARGE` |
| compact guide | error (timeout) | 2 | 2 | 25,005 | attempt 1 generated in 16.5s and failed validation (`A view relates to an unknown view.`); attempt 2 hit `MODEL_PROVIDER_TIMEOUT` at the 25s deadline |

Raw results: `result-2026-10-21T13-51-07-111Z.json` (current), `result-2026-10-21T13-51-11-890Z.json` (compact).

## Reading

1. **The budget fix works end to end.** The compact guide accepted the 10 KB file and sent two real requests; the current prompt could not send one.
2. **The next binding constraint is the 25-second deadline**, not the body cap. One generation with a 10 KB source took 16.5s; a repair then had 8.5s and timed out. Any repair loop on source-heavy tables needs a larger total deadline (the plan's own latency target is P95 ≤45s) or a two-phase path where the table can activate before the visuals are repaired.
3. **View validity remains the fragile part of the reply** (`A view relates to an unknown view.`), consistent with the main A/B arms.

Caveats: n=1 for this probe; the page prompt asks for a chart, which adds output tokens; the compact guide used here is the 5,041-char draft (final artifact 5,090).
