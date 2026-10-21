# Live A/B — current prompt vs compact schema guide

Both arms use the same 20-case corpus, same model (`deepseek-flash`, thinking disabled, json_object), same 4-attempt/25s repair loop, same validator. Two independent trials per arm.

| metric | current prompt (2 runs) | compact guide (2 runs) |
| --- | ---: | ---: |
| matched expectation, mean | 16.5/20 | 18.5/20 |
| drafts, mean | 10.5 | 12.5 |
| first-attempt drafts, mean | 3.0 | 5.5 |
| first-attempt share of drafts | 29.2% | 43.9% |
| requests per run, mean | 40.0 | 36.5 |
| cost per run, mean | $0.0695 | $0.0677 |
| case P95 ms (runs) | 19491 · 22226 | 21861 · 19698 |
| attempt P95 ms (runs) | 7278 · 8326 | 7204 · 6993 |

## Per-trial detail

| arm | run | matched | draft | clarify | reject | first-attempt drafts | requests | cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 2026-10-21T13-32-33-284Z | 15/20 | 9 | 9 | 2 | 3 | 41 | $0.0652 |
| current | 2026-10-21T13-42-39-047Z | 18/20 | 12 | 7 | 1 | 3 | 39 | $0.0737 |
| compact | 2026-10-21T13-39-36-132Z | 19/20 | 13 | 6 | 1 | 6 | 38 | $0.0695 |
| compact | 2026-10-21T13-45-55-166Z | 18/20 | 12 | 6 | 2 | 5 | 35 | $0.0658 |

## Per-case outcome (trial 1 / trial 2)

| case | expect | current | compact |
| --- | --- | --- | --- |
| basket | draft | ok / ok | ok / ok |
| deposit | draft | ok / ok | ok / ok |
| emoji | draft | ok / ok | ok / ok |
| dragon | draft | FAIL(clarify) / ok | ok / ok |
| join | draft | FAIL(clarify) / FAIL(clarify) | ok / ok |
| vague | clarify | ok / ok | ok / ok |
| sheets | clarify | ok / ok | ok / ok |
| injection | clarify | ok / ok | ok / ok |
| toomany | clarify | ok / ok | ok / ok |
| email | clarify | ok / ok | ok / ok |
| equipment-borrow | draft | ok / ok | ok / ok |
| shift-roster-csv | draft | ok / ok | ok / ok |
| cafe-sliders | draft | FAIL(clarify) / FAIL(reject) | FAIL(reject) / ok |
| light-shadow | draft | ok / ok | ok / ok |
| water-two-seats | draft | ok / ok | ok / FAIL(reject) |
| loan-formula | draft | FAIL(reject) / ok | ok / FAIL(reject) |
| chart-metric | draft | FAIL(reject) / ok | ok / ok |
| basket-en | draft | ok / ok | ok / ok |
| evolve-cafe | draft | ok / ok | ok / ok |
| inline-paste-clarify | clarify | ok / ok | ok / ok |

## What it suggests

- The compact guide raised the mean matched rate from **16.5/20 to 18.5/20** and the mean first-attempt share from **29.2% to 43.9%** across two trials.
- The known hard case `join` (cross-collection lookup) drafted in both compact runs; it failed both current runs.
- `cafe-sliders` and the simulation cases remained unstable in both arms; one rejection moved between cases, which is the expected model variance with n=2.
- Cost is flat ($0.0695 vs $0.0677): fewer prompt tokens offset by more successful long drafts.
- Latency is flat within noise (case P95 19491/22226 ms vs 21861/19698 ms).

## Caveats

- n=2 trials per arm; the model is non-deterministic. Treat this as a strong signal, not a decision.
- The compact guide used live was the 5,041-char draft; the final artifact is 5,090 chars (a 49-char reword), so a production candidate must rerun with the final text.
- The variant reworded one intro sentence ("compact schema guide" instead of "JSON Schema").
- No table was activated and no billing endpoint was called; the harness validates drafts with the production domain validator.
- The source-attachment fix is not exercised by this corpus (all sources are tiny). A separate run with 10 KB / 32 KB files is required to prove the cap fix end to end.
