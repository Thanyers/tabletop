# F078 — Architecture improvements with preserved behavior

| | |
| --- | --- |
| สถานะ | `review` (T1; later tasks tracked separately) |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — documentation, validation and internal refactors; evaluate each task separately |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F078-T*` |

## ทำไม

Current behavior spans several contract documents and broad UI/Room orchestration modules. Changes need stronger checks across the rendered client, authority and persistence adapters before internal refactoring. Long-lived rooms also need a measured storage and execution baseline.

## สิ่งที่ผู้ใช้จะเห็น

The existing workflows remain the acceptance baseline. This work targets clearer maintenance contracts and regression detection. The user authorized development and separate PRs on 2026-10-24, with no production release.

## ขอบเขต

รวม: current architecture map, reproducible local measurements, targeted integration gates, shared persistence conformance, incremental internal extraction, storage/recovery design and typed view registration when prerequisites are met.

ไม่รวม: changing visibility/consent/auto-apply/billing policy, new product behavior, production release, persistent schema changes, deleting/compacting saved data or restoring a shared database. Storage mutations require a separate exact scope and approval.

## ข้อเท็จจริงจากโค้ด

Baseline inspected on 2026-10-24: dev `9efebab0c4c9`. `CommandAuthority` shares deterministic domain rules between SQL and Room adapters. Compute uses an injected runner and revision-bound results. `VISIBILITY_POLICY` is open; money caps are deliberately disabled; consent covers an actor/table epoch and later files. No-file creation and later file attachment are already implemented.

## งาน

| ID | Separate PR scope | Prerequisite | Acceptance |
| --- | --- | --- | --- |
| T0 | Compatible security patches unblock existing dependency validation | — | Clean install, audit, existing unit/Worker/build checks; separate PR #264 |
| T1 | Current contract, capability map and this sequence | — | Source-linked policies and runtime differences agree; document links/public scan pass |
| T2 | Disposable local authority/storage/performance baseline | — | Repeatable bounded synthetic workload, raw samples + summary, source/environment labels, no shared/remote writes |
| T3 | Risk-targeted pre-merge integration gates | T1 | Real Worker startup checked before merge; selection has negative fixtures and preserves full-suite requirements |
| T4 | Shared repository conformance scenarios | T1 | Same duplicate/CAS/atomicity cases run against SQL and Room adapters without changing application semantics |
| T5 | Workspace command/navigation extraction | T2–T4; file ownership available | Existing create/attach/Ask/Change/ack/readback/switch paths pass; no domain mutation in UI |
| T6 | Room job coordination extraction | T2–T4; file ownership available | Same public job transitions, revision/epoch/receipt guards and recovery behavior |
| T7 | Storage lifecycle and recovery contract/rehearsal | T2, T4 | Measured growth, explicit receipt horizon and disposable restore checks; no saved-data deletion |
| T8 | Exhaustive built-in Canvas view registration | T3, T5 | Contract/schema/semantic/evaluation/render coverage; core does not import React |
| T9 | Extended load/soak and capacity comparison | T2, T5–T7 | Compare measured baseline before making capacity changes |

Each implementation PR owns its code and test files. Shared status documents are updated serially by the main agent. T5/T6 must check existing `doing` ownership before touching UI or Room hotspots. The first delivery group is T1–T4; subsequent tasks remain explicitly tracked with their prerequisites.

## คำถามเปิด

- Required retention and receipt replay horizon are not yet decided; do not infer deletion approval.
- Unsent starting-text persistence across devices is a product behavior decision and is outside behavior-preserving refactors.
- Target room count and latency SLO should be chosen after the baseline; measured results must not be represented as hosted capacity.

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-24 | Separate PRs, preserve behavior, integrate through dev only | User authorization; no production release |
| 2026-10-24 | Measurements precede refactoring and capacity changes | Establish an honest comparison and avoid speculative infrastructure changes |

## Verification

T1 candidate: [PR #260](https://github.com/Thanyers/tabletop/pull/260). Node v22.23.2; local Markdown targets checked, changelog fragment validation and public-file scan passed; whitespace check passed. Application/unit/browser suites are SKIPPED locally because this PR changes documentation only. Required CI initially failed on the unchanged dependency tree; T0 is a separate prerequisite, not a bypass or a PASS for that attempt. Final CI evidence is recorded in spec and the PR.
