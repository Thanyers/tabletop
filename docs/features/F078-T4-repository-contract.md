# F078-T4 — SQL and Room repository conformance

| | |
| --- | --- |
| สถานะ | `done` (merged dev `513336b`) |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — เพิ่มหลักฐานพฤติกรรมเดิมก่อน refactor |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F078-T4` |

## ทำไม

Node และ Cloudflare เก็บ workspace ผ่าน repository คนละตัว หากมีการปรับสถาปัตยกรรมต่อ เราต้องรู้ก่อนว่าทั้งสองตัวรักษา receipt, revision และ transaction เดิมเหมือนกันตรงไหน

## สิ่งที่ผู้ใช้จะเห็น

ไม่มี runtime behavior ใหม่ ผู้ดูแลโค้ดจะได้ชุดตรวจเดียวกันที่รันกับ PGlite และ SQLite ของ Room Durable Object จริง ก่อนเปลี่ยน repository ในอนาคต

## ขอบเขต

**รวม:** command ซ้ำและ receipt เดิม · command ID ที่ payload เปลี่ยน · คำสั่งแข่งกันบน revision เดียว · callback ล้มหลังเตรียม commit · outbox insert ล้มช่วงท้าย commit · epoch เก่า · สมาชิกที่ถูก revoke

**ไม่รวม:** การเปลี่ยน runtime/schema/migration · การเทียบ guest authentication ของ Node กับ hosted authentication ของ Worker · production หรือข้อมูลจริง

ทุก scenario ใช้ `CommandAuthority` จริง และตรวจแถว workspace, snapshot, event, receipt และ outbox จาก adapter ที่กำลังทดสอบ จุด fault อยู่ใน test adapter เพื่อให้ callback/commit ของ repository จริงเป็นฝ่ายทำ rollback

## ไฟล์

- `tests/support/repository-conformance.ts` — scenario กลางและ structural adapter contract ไม่มี Node runtime import
- `server/repository-conformance.test.ts` — PGlite memory database, `SqlWorkspaceRepository` และ `CommandAuthority` จริง
- `cloudflare/repository-conformance.test.ts` — Room Durable Object ภายใต้ Cloudflare test runtime, `RoomRepository` และ `CommandAuthority` จริง
- [REPOSITORY_CONFORMANCE.md](../REPOSITORY_CONFORMANCE.md) — สัญญาและคำสั่งรัน focused suites

## การตรวจ

ทดสอบบน worktree ที่อิง `0d5f2ea3870569095f419ffeecaf039156f7dae0` ด้วย Node `v22.23.2` และ npm `11.0.0`:

- `npm test -- server/repository-conformance.test.ts` — ผ่าน 7/7 scenarios บน PGlite และ `SqlWorkspaceRepository`
- `npm run test:cloudflare -- cloudflare/repository-conformance.test.ts` — ผ่าน 7/7 scenarios บน Durable Object และ `RoomRepository`
- `npm run typecheck` — ผ่านทั้ง client, server และ Cloudflare TypeScript projects
- ESLint สำหรับไฟล์ TypeScript ใหม่ และ `git diff --check` — ผ่าน

ผลนี้ผูกกับ worktree ที่ยังไม่ commit; ให้บันทึก source SHA และทวน focused suites หลัง integration ก่อนย้ายสถานะเป็น review

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-24 | แชร์เฉพาะ scenario และ structural adapter interface; ให้ entrypoint ของแต่ละ runtime สร้าง repository จริงของตน | เทียบ persistence invariant โดยไม่ผูก suite เข้ากับ harness เฉพาะ runtime หรือทำให้ hosted auth ต้องเหมือน Node guest auth |
| 2026-10-24 | ทดสอบ late commit failure ด้วย outbox ID collision ในฐานข้อมูลทดสอบที่ทิ้งได้ | ทำให้ write ที่เกิดก่อน outbox ถูกตรวจ rollback ครบทั้ง workspace, snapshot, event และ receipt โดยไม่แก้ schema |

## Integrated prerequisite verification

After merging dev through F078-T1 and the F078-T0 dependency patch, ordinary `npm ci` reports 0 vulnerabilities. Focused SQL and Room suites each pass 7/7 on Node v22.23.2. Source review found no blocking findings; hosted identity equivalence, D1 directory replay ordering and production acceptance remain outside these seven scenarios.
