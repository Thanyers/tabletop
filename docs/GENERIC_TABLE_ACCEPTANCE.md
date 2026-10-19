# File-driven table acceptance

Status: implementation candidate. Production is not updated by this work until the gates below pass.

## Isolated staging scope (approved 2026-10-19)

The user explicitly approved the scope below in this chat on 2026-10-19. The two Google accounts are available for user-controlled sign-in. Provisioning and account acceptance are separate from production approval.

Use the existing Cloudflare account, a new Worker `tabletop-staging` and D1 database `tabletop-staging`. Origin: `https://tabletop-staging.ptchrr.workers.dev`. Stop provisioning if either named resource exists and is not identified by this task's receipt.

The Worker gets separate SQLite Room/Billing namespaces and the existing four runtime secrets (Google client ID/secret, administrator email, DeepSeek key). No credential is rotated and no credential goes to GitHub or browser assets. Add only the staging Google redirect `https://tabletop-staging.ptchrr.workers.dev/api/auth/google/callback` while preserving the existing production callback.

On the new empty staging D1, apply `0001_identity.sql` and `0002_table_kind.sql` in order. This creates `app_meta`, `users`, `web_sessions`, `oauth_states`, `rooms`, `room_members`, `edge_limits`, indexes and migration bookkeeping, then extends the room kind constraint. Expected existing business rows affected: zero. The Room/Billing classes initialize their existing tables only in new staging objects. D1 migration batches and each room command are transactional; directory synchronization uses the existing retryable outbox.

Test writes are limited to two user-controlled Google accounts and at most six disposable acceptance rooms for the three synthetic source scenarios. Expect two user records, up to six room directory records, up to twelve owner/participant membership references, and bounded session/OAuth, command, snapshot, event, invitation and model-job rows (exact count depends on retries). No existing production room is selected or reset. Stop if the environment or existing-resource scope differs.

Staging AI ceiling: USD 0.20 per UTC day **and** USD 0.20 per UTC month, separate from the existing production ledger. Stay on Workers Free; no Paid upgrade, R2, DNS or domain purchase. The loopback acceptance runner also limits real provider calls to six and uses its own disposable USD 0.20 ledger. These ceilings do not limit unrelated uses of the same provider key.

Recovery: preserve test data and receipts; disable staging public access if a release fails. Do not delete the new database as rollback. Production code, bindings, data and secret values remain untouched during this staging stage.

## Compatible recovery build

After a `table` room exists, do not restore the old three-kind Worker. Keep the new schema-compatible code and set `TABLE_READ_ONLY=true` to stop new table creation, joining, invitations, actions, rule edits and AI proposals while preserving room reads and resume. Session refresh, model status and billing reconciliation may still write bookkeeping. The code also rechecks the switch before model dispatch and candidate commit.

A request already running in the previous deployed version can retain its previous configuration. Stop new table writes first, let existing provider calls finish or reach their bounded timeout, and verify no table job remains running/committing before declaring the recovery read-only. Reconcile uncertain usage without retrying provider dispatch. Retain the database and room state; a forward fix can re-enable writes after verification. Staging must exercise this compatible recovery before any production migration.

## Test matrix

| Scenario | Success path | Conflict / rejection | Resume |
| --- | --- | --- | --- |
| Equipment lending | Owner uploads inventory and loan policy, AI proposes fields/actions, owner reviews/activates, participant borrows camera | Simultaneous borrow: one winner; another account cannot return the loan | Both accounts reload and see the same borrower |
| Team shifts | Upload availability; AI creates roster and a two-person atomic swap | Reject unavailable slot; simultaneous swaps cannot silently overwrite a newer assignment | Login again preserves swapped assignments |
| River Race board game | Upload custom rules; two seats take turns scoring | Wrong-turn/other-boat actions rejected; review a scoring change mid-game | Existing scores and current turn survive rule activation and login |

Use the same generic interpreter for all three. No scenario name dispatch exists in production. Test fixture provider outputs are explicitly synthetic; the live provider run records separate receipts and never counts as two-account Google acceptance.

## Gates and evidence

- Local unit and SQL integration tests: PASS 297/297. Cloudflare auth, D1/Room, AI and billing tests: PASS 49/49. These include the 13 generic-domain tests and an in-flight AI read-only recovery test.
- CI browser tests, including file inputs, browser drag/drop events and all three table scenarios: pending.
- Independent read-only review: PASS after fixes for storage bounds, retained source references, monotonic revisions, in-flight model recovery and explicit source consent.
- Real provider proposals through the Worker and budget ledger: PASS for all three scenarios plus a live mid-game scoring change (four successful provider responses in the final run). Earlier trials exposed invalid row-ID references and misunderstood uniqueness/identity semantics; those outputs were rejected without activation, and the general provider instructions were corrected. No scenario-specific production dispatch or relaxed validation was added. Evidence is retained under ignored `test-results/generic-table-local/`.
- Local browser interaction: file picker, source review, draft review, simulation/validation/approval/activation and a real table action observed through the app UI with synthetic accounts/provider. This does not count as actual Google acceptance.
- Two actual Google accounts: user confirmed availability; pending staging login/invite/action/reload/logout/login verification.
- Production migration/release: pending all gates and a separate exact production schema scope approval. No automatic main-branch merge.

Prepared migration behavior follows [D1 foreign-key transaction guidance](https://developers.cloudflare.com/d1/sql-api/foreign-keys/). Isolation follows [Workers environment guidance](https://developers.cloudflare.com/workers/wrangler/environments/), with explicit separate bindings.
