# Tabletop R1 local verification

**Date:** 18 October 2026, Asia/Bangkok. **Disposition:** Local Verified implementation candidate. **Branch:** `feat/tabletop-r1` in [Thanyers/tabletop](https://github.com/Thanyers/tabletop). This report is part of the candidate it describes; the PR/commit metadata identifies the exact delivered revision.

The approved scope is local implementation before choosing hosting and a model provider. There is no hosted application URL, deployment receipt, live-provider result, two-device result, or production-readiness claim.

## Executed checks

| Check | Result | Evidence / reproduction |
| --- | --- | --- |
| Full unit and local SQL integration suite | **PASS: 242 tests, 36 files** | `npm test`; includes 53 R1 tests and 189 retained baseline tests |
| Local Component Lab regression suite | **PASS: 7 tests** | `node --import tsx --test scripts/component-lab/component-lab.test.ts`; injected generator only |
| Seven independent Edge browser contexts | **PASS: 7 workflow groups, no uncaught JavaScript errors** | `npm run test:r1:browser`; temporary database, real HTTP/WS, actual source files |
| Frontend and server TypeScript | **PASS** | `npm run typecheck` |
| Vite production bundle | **PASS** | `npm run build`; legacy opt-in chunk retains a size warning |
| Fresh locked install | **PASS** | Node 22.23.2 / npm 10.9.8, `npm ci --ignore-scripts` in a separate empty test directory |
| Windows launcher and development proxy | **PASS** | Built app starts on loopback 4310; Vite 5173 creates a session, accepts a command, and delivers an authorized WebSocket projection |
| Dependency advisory check | **PASS: 0 reported advisories** | `npm audit --json`, dated to this run; not a guarantee against unknown vulnerabilities |
| Publication path/pattern scan | **PASS: no findings** | `node scripts/check-public-files.mjs`; exact authorized-credential comparison also runs before delivery |
| Independent authority/domain review | **No remaining P0/P1 issue found in the reviewed local paths** | Privacy projection, invite retry, snapshot order/cursor, expiry, and model-tombstone findings corrected before final tests |

Raw JSON results and screenshots are generated beneath ignored `test-results/`. The browser suite captures invoice desktop/narrow, teacher/learner, and DM/player views. The GitHub workflow regenerates test summaries; local execution is not evidence that a remote CI run has passed.

## What the browser test proves

1. Shipment CSV and text PDF inputs are actually uploaded, parsed, and human-review actions are exercised. Imported sources remain `provided` until review.
2. A manually entered dated surcharge moves through proposal, simulation, validation, approval, and activation. The computed table, exact-satang CSV, evidence links, saved run, and refresh agree. Sample expected/billed totals are THB 155.00.
3. The narrow viewport retains working controls and a horizontally scrollable table without page-level overflow.
4. Teacher plus two learner sessions share the physics model. Local experiments do not overwrite shared parameters; representation/difficulty and answers are scoped correctly. A learner cannot perform a teacher command.
5. The reset confirmation traps keyboard focus and reset revokes prior learner access.
6. DM plus two player sessions perform an actual ally-shield reaction. Private pending hit values are absent from player projections, AP is charged/restored, HP agrees, forbidden DM actions are refused, and refresh preserves state.
7. All seven browser contexts complete without uncaught JavaScript errors.

The browser suite deliberately spaces scenarios across the one-minute API-rate window because all seven automated actors share one loopback IP. The application's throttle remains enabled.

## Failure, privacy, and recovery coverage

| Area | Executed evidence |
| --- | --- |
| Commands and identity | `server/authority.test.ts`: workspace isolation, wrong-role denial, CAS, exact-command retry, invite one-use/expiry, reset revocation |
| Realtime | Delayed per-peer sends remain serialized; private changes do not notify unrelated learners; actor-bound cursors resynchronize snapshots; pending outbox survives restart |
| Durable state | `server/features.test.ts` and authority tests close/reopen on-disk PGlite and recover accepted rules, sources, saved runs, and revisions |
| Retention | Expired workspace content is scrubbed, sessions revoked, and queued local source objects physically removed |
| Imports and exports | Malformed CSV/binary/MIME/base64 rejection, bounded text-PDF import, no partial invalid import, authenticated source download, HTML escaping and spreadsheet formula neutralization |
| Evolution | Stale/forged proof and expired approval are refused; invalid rules do not activate; rollback creates a new revision |
| Manifest compiler | Typed ports, missing/duplicate inputs, private-flow violation, unsupported capabilities, schema bounds, and cycles are refused without partial execution |
| Model gateway | Eleven injected-provider tests cover schema refusal, reservation/deduplication, timeout, cancellation, queue drain, budget refusal, and reset tombstones; **no live-provider proof** |

Initial browser attempts exposed selector ambiguity between Canvas and Focus table and a test burst that correctly hit the API throttle. The harness now scopes controls to the active surface and respects the normal rate window. These earlier failures are not reported as product acceptance passes.

## Not executed or outside this result

- External PostgreSQL instance, migration/restore drill, replica coordination, load/latency, and two physical devices.
- Docker image build/run: the local Docker daemon was unavailable. The Dockerfile is a reviewed packaging candidate.
- Public hosting, TLS/DNS/edge configuration, deployed asset parity, interrupted hosted deployment, and operational rollback.
- Private object storage service, malware scanning/quarantine, public upload abuse tests, and production deletion/backups.
- Live model adapter, provider retention/cost agreement, holdout generation proof, and real provider outage/billing behavior.
- Formal accessibility certification, exhaustive browser compatibility, and the entire legacy demo's browser suite. Current desktop/narrow interaction and keyboard checks have bounded coverage.

The manual editor satisfies the locally deferred-provider scope. It does **not** satisfy the original plan's live, non-scripted model-evolution acceptance gate. The full hosted R1 milestone remains open. A later [DeepSeek provider preparation check](AI_PROVIDER_VERIFICATION.md) adds isolated live synthetic calls and updated test counts; it does not change this report's original app/browser acceptance scope.

## How to recover locally

Stop the server before copying `server/.data/` (or the configured data directory). Keep an untouched copy before testing a schema change. Application rollback means starting a known compatible code revision against its compatible data snapshot; do not run a destructive down migration. Reset is a deliberate workspace operation and revokes existing guest sessions.

For the next stage, use the [implementation boundaries](R1_ARCHITECTURE.md) and earlier deployment blueprint to select the host, region, budget, managed PostgreSQL, upload service, and model. Run the hosted acceptance matrix against the exact deployed artifact before calling the app a reviewable hosted alpha.
