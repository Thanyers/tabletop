# DeepSeek provider preparation — 18 October 2026

## Result and scope

**Provider access and three synthetic invoice proposals: PASS after a prompt correction. Application integration and production deployment: NOT COMPLETE.**

The server-side `DeepSeekProvider` calls the official `https://api.deepseek.com/chat/completions` endpoint with `deepseek-flash`. The current [DeepSeek model documentation](https://api-docs.deepseek.com/) maps that alias to **DeepSeek-V4.1-Flash-1017**. The alias is not an immutable version pin. A credential supplied locally as `DEEPSEEK_KEY` authenticated successfully against `/models`; both `deepseek-flash` and `deepseek-v4-pro` were listed.

The provider accepts bounded invoice inputs and returns a schema-checked draft plus token usage. It cannot approve, activate, or write a workspace. The live application capability remains disabled: `server/features.ts` still reports `MODEL_NOT_CONFIGURED`. Adding a key does not bypass that boundary.

## Live synthetic checks

The probe used synthetic rate-card excerpts only, with no uploaded documents, customer data, game state, GitHub credential, or local paths in the model input. It made no workspace/database writes. Requests used non-thinking JSON mode, at most 512 output tokens, a 30-second timeout, no tools, no provider fallback, and no automatic retries.

| Final regression sample | Semantic result | Input tokens | Output tokens | Wall time |
| --- | --- | ---: | ---: | ---: |
| English remote surcharge | PASS — 750 satang, correct scope/date/source | 443 | 57 | 999 ms |
| Thai regional base rate | PASS — 4,250 satang and exact exclusive end date | 453 | 62 | 1,113 ms |
| Weight-step rule | PASS — 1,050 satang, correct scope/date/source | 448 | 56 | 897 ms |

These are three short regression samples from this Windows host. They do not establish a latency SLO, representative quality rate, DnD narration quality, OCR accuracy, comparative model ranking, or hosted performance. They are not unseen holdouts: one sample exposed a prompt defect and was rerun after correction.

The initial Thai sample returned `to: 2026-12-31` for a source valid **before 2027-01-01**. This was valid JSON but wrong for the application's half-open `[from,to)` interval. One diagnostic request reproduced it. The prompt now specifies integer satang, zone values, and inclusive-start/exclusive-end dates, including retaining an explicitly exclusive boundary rather than subtracting a day. The corrected sample returned `to: 2027-01-01`. Schema validation alone would not have caught this semantic mistake.

Six synthetic generation requests were made in total: two initial samples, one diagnostic, and three final samples. Their recorded total usage was 2,342 input tokens (384 cache hits, 1,958 misses) and 356 output tokens. Using the [published rates](https://api-docs.deepseek.com/quick_start/pricing/), that is approximately **0.000508452 USD off-peak / 0.001016904 USD peak**, before any other account charges or adjustments. The final three alone are 0.000268968 / 0.000537936 USD. These are usage-based estimates, not a billing-statement reconciliation.

The local report for the final run is `test-results/deepseek/probe.json` (ignored by Git). It stores timing, counters, and semantic check outcomes, not credentials, prompts, or raw provider bodies.

## Secret and failure boundaries

- The key is passed only to server-side code and stored in a JavaScript private field. Provider errors contain fixed messages; raw HTTP bodies, headers, keys, and fetch exceptions are not returned.
- Endpoint and model are fixed, redirects are rejected, and there is no retry or automatic fallback. Request size, rule count, response bytes, output tokens, and elapsed time are bounded. Cancellation does not prove that the provider did not bill the request.
- Responses must be complete assistant JSON with an allowed invoice changeset, matching source IDs and valid usage counters. Unsupported fields, tools, malformed/truncated output, and oversized output are refused.
- The original credential file remains outside this Git checkout. `.env*` and `.dev.vars*` are ignored by Git and Docker, except the tracked `.env.example` with empty secret values. No credential file was uploaded or copied to a hosting provider.
- The exact current DeepSeek/GitHub credential values were absent from all **304 reachable Git blobs** checked locally and **228 existing build files** across the parent demo and R1. This covers the local reachable history and inspected builds, not every possible log, unreachable object, remote fork, or external copy.
- The new R1 build was made with a harmless `DEEPSEEK_KEY` canary. The browser-asset scan passed across **118 files**. A separate disposable fixture proved that the guard rejects a canary leak and accepts clean assets. CI now builds with that canary and runs the guard, without a real provider key.

## Automated verification

- Full unit/local SQL suite: **252 tests in 37 files passed**. Report: `test-results/provider-preparation-unit.json` (ignored).
- Focused provider/model seam suite: **21 tests passed**. Ten tests cover the new provider and eleven cover the existing gateway.
- Project and server TypeScript checks plus Vite production build: **PASS**. Existing build warnings remain for third-party pure annotations and a legacy bundle over 500 kB.
- Publication path/pattern scan and browser secret guard: **PASS**. These checks reduce common mistakes; they are not a complete security audit.

Browser acceptance was not rerun locally for this preparation because no UI, HTTP route, or authority behavior changed. The previous seven-context browser result remains the baseline; it is not evidence of a live AI flow. Container execution, external PostgreSQL, hosted tests, account recovery, and production cost enforcement remain unverified.

## Reproduce deliberately

Use Node 22.23.2 or a compatible supported Node version. The application does not load `.env` files automatically. The probe reads only the named `DEEPSEEK_KEY` from an explicitly supplied ignored file and does not load other credentials into the environment.

```powershell
# Read-only model-access check; does not generate tokens.
node --import tsx scripts/check-deepseek.mjs --env-file=../.env.deploy.local

# Up to three billable synthetic requests, never run automatically by CI.
node --import tsx scripts/check-deepseek.mjs --env-file=../.env.deploy.local --smoke

# Existing CI mistake checks; run the browser check after building with the canary.
node scripts/check-public-files.mjs
node scripts/check-client-secrets.mjs
```

See [Production setup and costs](PRODUCTION_SETUP.md) for runtime secrets, session/account separation, the proposed hosting budget, and the remaining integration work. The next live-app milestone needs authenticated atomic draft dispatch, a reset-independent cost ledger, consent/source previews, workflow adapters, and the plan's holdout/failure tests. The Docker runtime currently omits the unused provider/model modules; its packaging must change when those modules are wired into the app.
