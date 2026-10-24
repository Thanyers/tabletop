# F078-T2 — Disposable local authority and storage baseline

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — development verification; existing behavior |

## ทำไม

Architecture improvement task authorized on 2026-10-24. Establish evidence before refactoring.

## ขอบเขต

Bounded synthetic disposable SQL workspace; raw timings and storage counts with SHA/environment. No remote/shared writes or retained-data compaction.

## Ownership

new scripts/architecture-baseline.ts and tests; docs/ARCHITECTURE_BASELINE.md

## Acceptance

Implementation and focused verification pending; source SHA, Node version and measured results must be recorded before review. No production release.
