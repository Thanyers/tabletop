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

## Production scope to review after staging

Production is a separate target from the approved staging resources. Read-only preflight on 2026-10-19 observed Worker `tabletop`, D1 `tabletop-production`, three existing rooms (one each invoice, teaching and encounter), three active membership rows, migration `0002_table_kind.sql` pending, and no observed foreign-key blockers. These are point-in-time counts and must be refreshed before approval/execution. A different row count, schema or live deployment requires reconciling the proposed scope first.

The pending migration renames `rooms` and `room_members` to temporary legacy tables, recreates the two named tables with the expanded room-kind constraint, copies all existing directory/member rows, removes the copied legacy tables and recreates `room_members_room_idx`. The reviewed batch must preserve the three legacy room kinds and memberships. The test suite verifies transactional rollback of a failed batch. Before an approved production run, retain a scoped, private backup of these directory tables and their schema; do not export authentication/session/credential tables into a release artifact.

Deploy only the tested schema-compatible Worker/assets from the reviewed commit. Preserve existing bindings, credentials, Workers Free selection and the observed production AI ceilings of USD 1/day and USD 10/month. Existing room state inside Durable Objects is not imported, reset or replaced. The compatible recovery switch preserves reads and uses a forward fix; it is not a claim that dropping/rebuilding directory tables has an automatic reverse migration. Any database restore must use the explicitly approved affected scope and a current recoverable backup.

This document prepares a reviewable operation; it does not authorize production schema changes, restore, deployment or an automatic main-branch merge.

## Test matrix

| Scenario | Success path | Conflict / rejection | Resume |
| --- | --- | --- | --- |
| Equipment lending | Owner uploads inventory and loan policy, AI proposes fields/actions, owner reviews/activates, participant borrows camera | Simultaneous borrow: one winner; another account cannot return the loan | Both accounts reload and see the same borrower |
| Team shifts | Upload availability; AI creates roster and a two-person atomic swap | Reject unavailable slot; simultaneous swaps cannot silently overwrite a newer assignment | Login again preserves swapped assignments |
| River Race board game | Upload custom rules; two seats take turns scoring | Wrong-turn/other-boat actions rejected; review a scoring change mid-game | Existing scores and current turn survive rule activation and login |

Use the same generic interpreter for all three. No scenario name dispatch exists in production. Test fixture provider outputs are explicitly synthetic; the live provider run records separate receipts and never counts as two-account Google acceptance.

## Gates and evidence

- Local unit and SQL integration: PASS 299/299. Cloudflare auth, D1/Room, AI and billing tests: PASS 65/65, including the natural-language assistant, private history, bounded context, confirmation/recovery and membership broadcast regressions. All three TypeScript projects, the frontend build, Worker dry-run bundle and the public demo check (nine scenarios, 55 steps) pass on the implementation candidate. Public-file and credential-value scans pass without exposing secrets.
- CI browser tests, including file inputs, browser drag/drop events and all three table scenarios: pending.
- Independent read-only review: PASS after fixes. The earlier domain/recovery candidate passed after fixes for storage bounds, retained source references, monotonic revisions and explicit source consent. The assistant review found confirmation crash recovery and reused-command-ID cases that could leave chat processing indefinitely. Bounded transactional receipt/timeout recovery now terminalizes both cases, preserves immutable receipts/results and blocks late actions. Re-review found no remaining P0/P1 in these paths or the capability gate; hosted behavior is still a separate gate.
- Real provider proposals through the Worker and budget ledger: PASS for all three scenarios plus a live mid-game scoring change (four successful provider responses in the final run). Earlier trials exposed invalid row-ID references and misunderstood uniqueness/identity semantics; those outputs were rejected without activation, and the general provider instructions were corrected. No scenario-specific production dispatch or relaxed validation was added. Evidence is retained under ignored `test-results/generic-table-local/`.
- Local browser interaction: file picker, source review, draft review, simulation/validation/approval/activation and a real table action observed through the app UI with synthetic accounts/provider. This does not count as actual Google acceptance.
- Two actual Google accounts: PASS on isolated staging for all three scenarios, single-use invites, participant source/draft privacy, concurrent borrow/swap, invalid-action rejection, mid-game scoring changes, reload and account resume. Three retained synthetic rooms were used. River Race resumed with rule r2 and scores 2/3 in both browsers. Private evidence is retained under ignored `test-results/generic-staging/`; no Google identity values or invitation tickets belong in published reports.
- Hosted findings: joining a room changed the revision without notifying existing sockets. Refreshing let the acceptance run continue; a new empty-outbox projection broadcast now passes its regression test, with a fresh hosted invitation check pending. Directory titles now derive from each active public program so resumed rooms can be distinguished.
- AI reliability: some live outputs were rejected, and one draft needed an owner-requested correction to its description. No invalid draft was activated. The rejected-field detail was not retained by the model-job error record, so the exact original schema failure is unknown.
- Assistant acceptance findings: Thai state explanations correctly used current scores and the active three-point rule, and a request to choose/play continuously was refused. A translated action request did not match the deterministic action-name guard; this case now returns a safe clarification instead of a generic failure. Until action-language matching is extended, a proposal request must name the visible action and its input values. The owner's implicit host seat is now recognized by the confirm button. CI also found that reload hid a pending rule draft behind Chat; the owner now resumes in Change rules while a draft awaits review. These fixes require the current hosted/CI recheck.
- Latest UX acceptance: the user requested an always-visible, natural request composer in place of the detached Ask AI object. The rail and natural-language route for both owners and participants are implemented and locally verified. They answer shared-state questions and prepare only explicitly requested actions for confirmation. Direct human Canvas play remains primary; no autonomous turns. CI, real-provider/two-account chat checks and hosted recheck remain pending.
- Project continuity acceptance: server-side tests pass for actor/room/epoch isolation, saved prompts/replies, history pagination and bounded context. The browser helper adds reload/follow-up checks and more than 20 synthetic exchanges to verify visible older-page navigation without another provider call; its CI run is pending. Each new request receives current authorized table state plus at most six recent completed exchanges. Oversized authoritative context is rejected before provider reservation/dispatch. Full semantic recall and automatic narrative summaries are outside this release and must not be implied by a persisted transcript. Actual hosted chat continuity and direct manual play while a proposal is pending remain to be witnessed.
- Production migration/release: pending all gates and a separate exact production schema scope approval. No automatic main-branch merge.

Prepared migration behavior follows [D1 foreign-key transaction guidance](https://developers.cloudflare.com/d1/sql-api/foreign-keys/). Isolation follows [Workers environment guidance](https://developers.cloudflare.com/workers/wrangler/environments/), with explicit separate bindings.
