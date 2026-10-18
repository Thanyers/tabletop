# Cloudflare release candidate

18 October 2026, Asia/Bangkok. **Local implementation; not deployed.** Google/Cloudflare/DeepSeek credential readiness has been checked without exposing values. No Cloudflare resource, remote schema, runtime secret, subscription, or public deployment was created during this preparation.

## What this candidate delivers

- Google accounts with persistent room membership, My tables, logout, and resume after a new login.
- A server-authoritative room per SQLite Durable Object, private multiplayer projections, one-use seat invitations, explicit replacement of lost unused links, and DM pause/resume.
- A metadata-only administrator panel. Admin status does not grant access to private game contents.
- Consented DeepSeek Flash drafts for invoice, teaching, and encounter, backed by a separate durable cost ledger. Simulation, validation, human approval, and activation remain explicit.
- Existing local Node guest mode and file imports remain available.

Cloudflare public file uploads are **disabled**. The sample invoice case, verified-source review, rules, calculations, and exports work; uploading a team's own files requires a later private R2/scanning/parser integration. Account deletion, configurable retention, full D&D rules, and private-content support overrides are outside this slice.

## Concrete provisioning scope for approval

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

## Budget awaiting approval

Proposed planning allowance: **infrastructure USD 10 + AI USD 10 = USD 20/month**, approximately THB 700 at the explicit planning assumption of THB 35/USD, before tax/fees. Workers Paid starts at USD 5/month with included allocations; see the detailed sourced scenarios in [Production setup](PRODUCTION_SETUP.md). Infrastructure charges can exceed this planning allowance; Cloudflare does not enforce it as a hard spending cap.

For this first limited release, propose an application AI cap of **USD 10 per UTC month and USD 1 per UTC day**, with conservative reservations before provider calls. The current checked-in values are zero and no cost approval has been recorded. This cap applies only to requests made through this application, not other use of the same DeepSeek key.

Read-only preflight could inspect Workers and D1; subscription/billing inspection returned HTTP 403. The account's paid-plan state is therefore unverified. The R2 listing also returned HTTP 403; R2 is not needed by this candidate while uploads stay disabled. No credential permissions were changed.

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

Ignored local reports: `test-results/production-candidate-unit.json`, `test-results/cloudflare-report.json`, `test-results/tabletop-r1/report.json`, and `test-results/cloudflare-browser/report.json`. CI retains summary JSON only. No real account/session secrets are in these fixtures or reports.

Review found and addressed out-of-order directory sync, cost omission for cached AI input, committed-AI receipt recovery, Origin normalization, lost invite acknowledgements, and the clipped admin dialog. The timeout/commit interleavings also pass. A native Workers browser test caught unsupported redirect mode and an unbound native fetch receiver missed by injected mocks; provider/OAuth requests now reject redirects using manual mode, and the provider fetch receiver is bound to the global runtime. One simulated provider request reaches the durable ledger and creates a draft without activating it. Independent review found no remaining material finding in its bounded scope.

## Hosted acceptance after approval

1. Confirm the target account, paid-plan state, empty new-resource scope, and approved budgets; provision only the resources above.
2. Apply the approved schema, replace the D1 placeholder ID, set positive approved AI budgets, and install only required secrets at Cloudflare.
3. Deploy the exact CI-passing commit; verify HTTPS, security headers, readiness, and served asset hashes against the build.
4. Complete actual Google sign-in with the owner's account and a separate teammate account. Check redirect, admin bootstrap, invite redemption, private projections, logout, and resume from a second device.
5. Exercise hibernation, delayed alarms, duplicate commands, redeploy/reconnect, and session revocation on live WebSockets. Validate storage recovery and code rollback without erasing progress.
6. Make bounded consented live AI requests for all three workflows; check provider schema, latency, durable accounting, daily/monthly rejection, and absence of automatic rule activation. Earlier provider probes and emulator results do not substitute for this.

Keep the release status pending until these hosted checks pass. Source publication to a draft PR is not production deployment.
