# Cloudflare release candidate

18 October 2026, Asia/Bangkok. **Public alpha deployed on Cloudflare Free; hosted acceptance is partial.** Open [Tabletop](https://tabletop.ptchrr.workers.dev). Runtime source: `a495cf5617f60af1c51087b54b6c145f0621e938`; active Worker version: `dfdc8c72-2fc2-4344-92c1-44fbc48d80d0`. The owner approved the resource/schema scope below and selected Free. No Paid subscription was activated. See the [post-deployment report](../handoff/Final/planning-review/TABLETOP_R1_POST_DEPLOY_TEST_REPORT.md) for executed checks and remaining gates.

## What this candidate delivers

- Google accounts with persistent room membership, My tables, logout, and resume after a new login.
- A server-authoritative room per SQLite Durable Object, private multiplayer projections, one-use seat invitations, explicit replacement of lost unused links, and DM pause/resume.
- A metadata-only administrator panel. Admin status does not grant access to private game contents.
- Consented DeepSeek Flash drafts for invoice, teaching, and encounter, backed by a separate durable cost ledger. Simulation, validation, human approval, and activation remain explicit.
- Existing local Node guest mode and file imports remain available.

Cloudflare public file uploads are **disabled**. The sample invoice case, verified-source review, rules, calculations, and exports work; uploading a team's own files requires a later private R2/scanning/parser integration. Account deletion, configurable retention, full D&D rules, and private-content support overrides are outside this slice.

## Approved provisioning scope

Target: the already verified Cloudflare account with Workers subdomain `ptchrr`. Planned origin: `https://tabletop.ptchrr.workers.dev`. Google must allow exactly `https://tabletop.ptchrr.workers.dev/api/auth/google/callback`.

| Resource | Proposed operation | Existing business rows affected |
| --- | --- | --- |
| Worker `tabletop` | Create Worker, upload this reviewed commit and static assets; bind D1 and SQLite DOs; enable its workers.dev hostname and hourly bounded maintenance | 0; the named Worker was absent at read-only preflight |
| D1 `tabletop-production` | Create a new dedicated database and apply `cloudflare/migrations/0001_identity.sql` | 0; the named database was absent; verify again immediately before creation |
| SQLite DO class `Room` | Register class migration `v1`; initialize tables inside each newly created room | 0 initially; new rooms receive seed game state and membership when used |
| SQLite DO class `Billing` | Register class migration `v1`; initialize the global reservation/usage ledger | 0 initially; rows are created only by subsequent AI requests |
| Worker runtime secrets | Install only Google client ID/secret, admin email, and DeepSeek key from the existing local credential file | No existing credentials rotated or revoked |

D1 migration tables: `app_meta`, `users`, `web_sessions`, `oauth_states`, `rooms`, `room_members`, and `edge_limits`, plus the indexes shown in the migration. It stores accounts/session hashes and discovery references, not the room's authoritative private game state. Wrangler also writes migration bookkeeping.

Room tables: `room_identity`, `room_workspaces`, `room_memberships`, `room_invitations`, `room_snapshots`, `room_events`, `room_commands`, `room_outbox`, `room_artifact_cleanup`, `room_approvals`, `model_jobs`, and `room_directory_outbox`, plus their declared indexes. Billing creates `billing_jobs` and its day/month/lease indexes.

Runtime writes are scoped to the authenticated account, authorized room, command receipt, or AI job. Scheduled maintenance removes only expired OAuth states (up to 5,000), hard-expired sessions (up to 1,000), and old edge-limit windows (up to 1,000) per hourly invocation. It does not delete saved games. An owner-triggered reset is a separate, explicit destructive game action.

Each D1 migration must complete successfully on the new empty database. Room changes use local SQLite transactions; D1 directory writes use an ordered retryable outbox. There is no global D1/DO transaction. If the resource already exists or contains business data, stop and recheck the scope instead of applying an assumed empty-database plan.

Recovery: keep the last deployed Worker version and use compatible code rollback. On first release failure, disable public access and retain D1/DO data for diagnosis. Do not DROP databases or erase player progress as rollback. Verify a disposable D1 export/restore and individual Room/Billing recovery procedure before treating this as production-ready; cross-store backup consistency is still an acceptance gate.

No R2 bucket, DNS change, custom domain purchase, Render/Supabase resource, GitHub credential upload, or automatic main-branch merge is included.

## Approved budget and selected plan

The owner approved a planning allowance of **infrastructure USD 10 + AI USD 10 = USD 20/month** and subsequently selected **Workers Free for the initial test**. The Cloudflare base subscription is therefore USD 0; DeepSeek is billed separately. The allowance is not a prepaid charge. No Paid checkout was accepted. A later Paid upgrade is a separate decision and does not have a provider hard spending cap.

The deployed application AI caps are **USD 10 per UTC month and USD 1 per UTC day**, with conservative reservations before provider calls. Checked-in budget values remain zero; the approved deployment configuration supplies the positive limits. The Free deployment omits the checked-in custom 50 ms CPU setting and uses the platform's Free limit. This cap applies only to requests made through this application, not other use of the same DeepSeek key.

The dashboard confirmed the Free plan. The approved new D1 database and seven application tables were created, the Room/Billing SQLite classes were registered, four runtime secrets were installed, and the workers.dev hostname was enabled. Public preview URLs remain disabled. R2 is not used while uploads remain disabled. No credential permissions were changed.

## Verification record

Local checks use synthetic accounts and disposable databases. The checks below were executed on the candidate before source publication:

| Check | Local result |
| --- | --- |
| Full domain/client/Node suite | 269 tests passed across 39 files |
| Existing Component Lab | 7 tests passed |
| TypeScript frontend/server/Worker | Passed |
| Dependency audit | 0 known vulnerabilities in the checked lockfile |
| Browser build secret canary | 119 assets checked; no findings |
| Worker bundle | Dry run passed; no upload/deployment |
| Cloudflare D1/DO/OAuth/ledger tests | 41 tests passed across 4 files, including timeout/commit interleavings |
| Node browser acceptance | 7 scenarios passed across 7 independent contexts; no uncaught errors |
| Cloudflare browser acceptance | 8 scenarios passed: separate accounts, invite recovery, privacy, pause/resume, admin, consented AI draft, logout/resume, desktop/mobile |

Ignored local reports: `test-results/production-candidate-unit.json`, `test-results/cloudflare-report.json`, `test-results/tabletop-r1/report.json`, and `test-results/cloudflare-browser/report.json`. CI retains these summary JSON files for seven days, and the added auto-demo JSON/HTML reports separately for 30 days. No real account/session secrets are in these fixtures or reports.

Review found and addressed out-of-order directory sync, cost omission for cached AI input, committed-AI receipt recovery, Origin normalization, lost invite acknowledgements, and the clipped admin dialog. The timeout/commit interleavings also pass. A native Workers browser test caught unsupported redirect mode and an unbound native fetch receiver missed by injected mocks; provider/OAuth requests now reject redirects using manual mode, and the provider fetch receiver is bound to the global runtime. One simulated provider request reaches the durable ledger and creates a draft without activating it. Independent review found no remaining material finding in its bounded scope.

## Hosted acceptance and remaining work

Executed on the public origin: 14 HTTP/security/asset checks (including all 117 public non-index asset hashes), owner Google sign-in and admin bootstrap, creation of three tables, encounter reload, logout/login resume, and real AI drafts plus simulation in all three workflows. Four AI requests produced three drafts; the first teaching request failed with a generic message and the identical manual resubmission succeeded. Its cause is not established.

On 19 October (Asia/Bangkok), the owner specifically approved activation of the existing encounter test rule. The earlier APPROVED candidate first returned a generic permission/session error without changing r0. Reproposing the same rule through the UI, then simulating, validating, approving and activating succeeded. The room now has r1 (ally shield, 1 AP, once per character turn), and reload preserved it and revision options 0/1. No additional AI request or room reset occurred. The exact cause of the first rejection was not captured; do not infer it from the separate 15-minute-approval test. See the [sanitized hosted history](auto-demo/hosted-activation-2026-10-19.json) and [repeatable local persona demos](AUTO_DEMO.md).

Two-account multiplayer, another device, hosted mobile interaction, full recovery/rollback, and live budget-negative tests are still pending. Emulator results below are not substitutes for those checks.

1. **Done:** confirm the target account, selected Free plan and limits, new-resource scope, and approved budgets; provision only the resources above.
2. **Done:** apply the approved schema, replace the deployment D1 placeholder ID, set approved AI budgets, and install only required runtime secrets.
3. **Done:** deploy the CI-passing runtime commit and verify HTTPS, security headers, readiness, and served asset hashes.
4. **Partial:** owner Google sign-in, admin bootstrap, logout and resume passed. A separate teammate account, invite redemption, private projections, and a second device remain.
5. **Pending:** live hibernation, delayed alarms, duplicate commands, redeploy/reconnect, session revocation, storage recovery, and compatible code rollback without erasing progress.
6. **Partial:** bounded consented live AI drafts and simulation passed for all three workflows, including one failed teaching request followed by a successful manual resubmission. The owner-approved encounter rule was manually activated and survived reload on 19 October. Hosted ledger readback, budget rejection and full latency characterization remain. No draft activated automatically.

Keep full hosted acceptance and production readiness pending until the remaining checks pass. The public URL can be used for limited team testing; the draft PR is not merged.
