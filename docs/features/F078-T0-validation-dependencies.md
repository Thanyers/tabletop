# F078-T0 — Restore dependency validation before architecture work

| | |
| --- | --- |
| สถานะ | `done` (merged dev `1ec4e61`; no production release) |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — compatible dependency security patches |

## ทำไม

On 2026-10-24 the existing dev dependency tree fails the required `npm audit --audit-level=high` check before application validation. F078-T1 PR #260 reproduced the baseline failure without changing dependencies.

## ขอบเขต

Patch Vitest within version 4, and use narrowly scoped overrides for Miniflare's Undici and the Cloudflare test plugin's Zod. Keep the current Worker/Container architecture and all validation gates. No production release or database changes.

## ข้อเท็จจริงจากโค้ด

- Root Zod is 4.6.7; the Cloudflare test plugin pins a separate 4.6.5 copy.
- Miniflare pins Undici 7.29.1. Patched Undici 7.30.1 retains the same major and supports Node 22.23.2.
- Vitest 4.1.12 patches the mocker advisories in 4.1.11.

## Acceptance

`npm ci`, audit, unit, Cloudflare tests, typecheck/build and Worker bundle must pass on Node 22.23.2. Record actual results before review. No broad audit-fix upgrade, downgrade of the Worker toolchain, or bypass of CI.

## Verification (2026-10-24)

[PR #264](https://github.com/Thanyers/tabletop/pull/264), Node v22.23.2:

- Standard `npm ci` (npm 11.0.0): passed; `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm test -- --reporter=json --outputFile=test-results/F078-T0-unit.json`: 901 passed, 5 skipped, 0 failed.
- `npm run test:cloudflare -- --reporter=json --outputFile=test-results/F078-T0-cloudflare.json`: 197 passed, 0 failed.
- `npm run build` (includes all typechecks), `npm run build:cloudflare` (dry-run), lint: passed; lint has 0 errors / 111 pre-existing warnings.
- Browser secret boundary scan: 143 assets / 0 findings. Public-file and staged whitespace checks passed before commit.
- Lockfile regeneration required a scoped npm 12.2.1 invocation because npm 10/11's peer resolver threw an internal `edgesOut` error; no global npm/config change. The resulting lock was then verified with ordinary npm 11 `npm ci` and tests.
- Browser suites run in full dev CI after integration; no production release is part of this task.

## Sources

- [Undici advisory](https://github.com/advisories/GHSA-4qv8-2p9j-2685)
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Vitest mocker advisory](https://github.com/advisories/GHSA-xp26-3454-mjgp)
