# File-driven shared Canvas

The signed-in app gains a blank `table` room. The existing invoice, lesson and encounter rooms retain their behavior and data. This is a bounded general table runtime: collections, typed fields, records, actions, conditions, atomic effects, unique constraints and optional turns. It does not execute generated code.

## User flow

1. Create a blank table, drop UTF-8 CSV, JSON, TXT or Markdown into its source container. Up to 32 KiB per file, four files and 64 KiB total. Source text is stored in the private room authority and only the owner can see it. Images, binary files and PDF are rejected with an explanation in this release.
2. Describe the task and explicitly consent to sending source text to the configured AI provider. The model returns a data-only program and initial rows. Every proposal names exact source quotations and lists assumptions. Unverified assumptions remain visible for human review.
3. Inspect the proposed tables/actions/evidence on Canvas. Simulate, validate, approve, then activate using the existing revision-bound lifecycle. New sources or actions invalidate stale approvals. Rule changes preserve current records and must retain compatible collections and fields.
4. Invite up to seven participants using individual single-use links. All participants see the shared active records, rules and actions. Uploaded source text, pending proposals and owner review are private to the owner. Do not upload secret data to shared active records.
5. Commands are checked server-side against membership, the latest revision, parameter types, conditions and invariants, and commit atomically. Conflicts require refreshing/reviewing; no automatic repeat of a stale action. History and the saved room are persisted. Closing a browser does not delete the room; sign in and select it again.

## Implementation boundaries

`table-contracts.ts` defines the transport. `domain/table.ts` owns validation, source ingestion and deterministic execution. Existing authority/repository transactions own concurrency, idempotency, persistence and permissions. Cloudflare AI owns budget and provider dispatch. Canvas renders the validated program rather than domain-specific case components. The existing database kind/role CHECK constraints need an explicitly reviewed migration before deployment; no production migration runs during local implementation.

Limits: six collections, twelve fields per collection, one hundred records per collection and two hundred in a room, sixteen actions, eight inputs per action, twenty-four conditions/effects, and up to twenty selectable rule revisions within a 256 KiB history budget. The room view keeps the latest one hundred action summaries with a separate monotonic action counter; authoritative event history remains in the server store. Programs are limited to 64 KiB and records to 128 KiB both at initialization and after every action. Sources cited by active or retained rule revisions cannot be removed. Later rule edits preserve the collection definitions and existing rows; changing the data schema is a separate future migration workflow.

## Acceptance gates

- Equipment lending: import inventory and policy; two actors reserve the same item; exactly one succeeds; only its borrower may return it.
- Team shift scheduling: import roster/availability; validate both sides of a swap; simultaneous swaps cannot overwrite one another or violate unique assignments.
- Custom board game: import rules and player rows; enforce turns and scoring bounds; change a scoring rule with review while preserving the ongoing score.
- All three run through the same interpreter with distinct source files, not switches on scenario names. Negative tests include malformed model output, unsafe keys, unsupported files, stale approvals, participant rule edits, duplicate command, invalid actions, and restart/resume.
- Actual two-account Google sign-in on an isolated staging deployment, invite redemption, shared updates/conflicts, logout/login and resume must be witnessed before production. Synthetic auth tests are additional evidence, never a substitute.
- Production remains on its existing version until the local/CI, review and two-real-account gates pass. Credentials stay in ignored local environment files and Worker secrets.
