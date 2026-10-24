# F078-T3 — Risk-targeted pre-merge integration gates

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — development verification; existing behavior |

## ทำไม

Architecture improvement task authorized on 2026-10-24. Establish evidence before refactoring.

## ขอบเขต

Boot the actual Worker artifact for relevant PRs before merge; preserve existing full-suite requirements and security/fixture behavior. Do not edit tests/cloudflare-browser.mjs (open PR #250).

## Ownership

new scripts/integration-gate*.mjs; validate.yml; gate tests/docs

## Acceptance

Implementation and focused verification pending; source SHA, Node version and measured results must be recorded before review. No production release.
