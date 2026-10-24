# F078-T4 — SQL and Room repository conformance

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — development verification; existing behavior |

## ทำไม

Architecture improvement task authorized on 2026-10-24. Establish evidence before refactoring.

## ขอบเขต

Same duplicate, conflict and transaction rollback cases against real disposable adapters. Preserve application behavior and do not change persistent schema.

## Ownership

new shared conformance scenarios; new server/cloudflare test entrypoints

## Acceptance

Implementation and focused verification pending; source SHA, Node version and measured results must be recorded before review. No production release.
