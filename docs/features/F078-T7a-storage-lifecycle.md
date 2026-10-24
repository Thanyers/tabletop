# F078-T7a — Storage lifecycle and recovery contract

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | DeepSeek Harness (lead) |
| เวอร์ชันที่คาด | PATCH — เอกสารสัญญาและการวัดในเครื่อง ไม่เปลี่ยน runtime/schema/retention |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F078-T7a` |
| เอกสารเจ้าของสัญญา | [STORAGE_LIFECYCLE.md](../STORAGE_LIFECYCLE.md) |

## ทำไม

ห้องที่ใช้งานยาวมี state, snapshot, event, receipt และ outbox เพิ่มขึ้นทุก commit แต่ยังไม่มีเอกสารที่ระบุว่า
แต่ละ store เป็นของใคร หนึ่งแถวหมายถึงอะไร reset ลบอะไรจริง และ receipt replay ได้นานแค่ไหนก่อนที่งาน T7b
(restore rehearsal) หรือ T9 (load/capacity) จะเริ่มได้ ความไม่ชัดนี้ทำให้เสี่ยงตีความว่า "มี retention อยู่แล้ว"
หรือ "กู้คืนได้" ทั้งที่โค้ดยังไม่มีทั้งสองอย่าง

## สิ่งที่ผู้ใช้จะเห็น

ไม่มี behavior ใหม่ ผู้ใช้ยังเล่นโต๊ะเดิมได้เหมือนเดิม ผู้ดูแลระบบและผู้รีวิวได้สัญญา storage ที่อ้างบรรทัดโค้ดจริง
พร้อมการวัด relation bytes แบบจำกัดบนฐานข้อมูลทิ้งได้ เพื่อใช้ตัดสินใจก่อนอนุมัติงาน retention/restore ในอนาคต

## ขอบเขต

**รวม:** ชื่อ store ทั้งหมดและเจ้าของ · ความหมายของหนึ่งแถว · โมเดลการเติบโตต่อ commit · semantics ของ
reset และ expiry ที่ต่างกันระหว่าง Room กับ Node · idempotency receipt replay horizon (บันทึกเป็นคำถามเปิดที่
**ยังไม่ตัดสิน**) · recovery manifest และ invariant ของการ restore · สิ่งที่ยัง**ไม่**พิสูจน์ · สคริปต์วัด
relation bytes/row counts บน PGlite in-memory และ focused test

**ไม่รวม:** การลบ/compact/expire/migrate ข้อมูลที่บันทึกไว้ · การเปลี่ยน schema, retention default, TTL หรือ
runtime behavior · การ restore จริงหรือบน production · การอนุมัติจำนวนวัน retention · การแตะ D1 migration
หรือ Durable Object storage

## ข้อเท็จจริงจากโค้ด

ตรวจบนฐาน `origin/dev` `90c0ad0` (branch นี้แตกจาก SHA นี้) เมื่อ 2026-10-24:

- **Room ไม่มี migration system.** `RoomRepository` สร้างใหม่ทุกครั้งแล้วรัน `TABLES` ทั้งชุด
  (`cloudflare/room-repository.ts:293-301`); ทุก statement เป็น `CREATE TABLE/INDEX IF NOT EXISTS`
  จึงไม่มีทางแก้ column ของห้องเดิมและไม่มี ledger ว่า schema ถึงรุ่นไหน `room_workspaces.schema_version`
  เป็น domain schema (`SCHEMA_VERSION = 1`) ไม่ใช่ database schema
- **Room ลบของทุก epoch ตอน reset; Node ลบเฉพาะ `epoch < newEpoch`.** Room ใช้
  `DELETE FROM ... WHERE workspace_id = ?` กับ outbox, commands, events, snapshots, invitations,
  invite links, approvals, images (`cloudflare/room-repository.ts:385-401`) แล้วเขียน receipt ของ reset
  หลังจากนั้น; Node ใส่ `NOT (epoch = $3 AND actor_id = $4 AND command_id = $5)` เพื่อเก็บ receipt ของ reset
  ไว้ (`server/repository.ts:928-932`) เพราะ receipt ถูกเขียนใต้ epoch เดิม
- **Receipt ของ reset เป็น receipt เดียวที่ replay ได้หลัง reset.** `execute` ค้น receipt ด้วย
  `expectedEpoch` ก่อนตรวจ epoch ปัจจุบัน (`server/authority.ts:824-828` ก่อน `:840`) คำสั่งเดียวกันกับ
  expected epoch เดิมจึงได้ `duplicate: true` จาก ack เก่า ขณะที่ receipt อื่นถูกลบและได้ `STALE_EPOCH`
- **Hosted room ไม่มี expiry ที่ทำงานจริง.** `RoomRepository.expireWorkspaces` คืน 0
  (`cloudflare/room-repository.ts:455-458`) และ `expires_at` ของ hosted room คือปี 9999
  (`cloudflare/room.ts:52`) ขณะที่ Node มี `WORKSPACE_TTL_MS` 7 วันและ sweep ที่ startup/timer
- **แถว `room_artifact_cleanup` ของ Room ไม่มีคนอ่าน.** `listPendingArtifactCleanup` ถูกเรียกจาก
  `server/bootstrap.ts` (Node) เท่านั้น ไม่มี caller ใน `cloudflare/`; hosted room ไม่รับ invoice upload
  คิวนี้จึงเข้าถึงได้เฉพาะทาง invoice reset และจะสะสมถ้าเกิดขึ้น
- **ไม่มี backup/restore tooling ในรีโป.** ไม่มีสคริปต์ export D1/DO, ไม่มี restore CLI และไม่มีงาน coordinated
  restore ข้าม D1 + Room + Billing; RPO/RTO ของ hosted ยังไม่ทราบ
- **Cap ที่มองเห็นไม่จำกัด storage.** `COMPUTE_LIMITS.runHistory = 24` ตัดเฉพาะ computeRuns ใน state;
  `MAX_TABLE_ASSISTANT_JOBS_PER_ROOM = 500` ปฏิเสธ job ใหม่แทนการลบแถวเก่า; outbox ที่ส่งแล้วและ
  `model_jobs` ที่ถูก revoke ยังอยู่ครบ

## ไฟล์

- [docs/STORAGE_LIFECYCLE.md](../STORAGE_LIFECYCLE.md) — สัญญา: store inventory, ตารางและความหมายของแถว,
  growth model, reset/expiry สอง adapter, replay horizon, recovery manifest/invariant และข้อจำกัด
- `scripts/storage-growth.ts` — CLI วัด PGlite in-memory: `--workspaces`, `--commits`, `--records`, `--points`,
  `--help`; เขียน JSON ไฟล์เดียวใต้ `test-results/storage-growth/` (ignored), ปิด DB ใน `finally`
- `server/storage-growth.test.ts` — focused test ของ CLI bounds, output-path junction, row-count invariant
  และความชันของการเติบโต
- `changelog.d/F078-T7a-storage-contract.md`, `spec.md`, `PLAN.md`, feature doc/feature index นี้

## การวัด

คำสั่ง (default flags: 2 workspaces × 24 commits, 20 records, 4 points):

```powershell
node --import tsx scripts/storage-growth.ts
```

ผลบน Node `v22.23.2`, PGlite `0.5.10`, Windows x64, 2026-10-24 (ไฟล์จริงอยู่ใต้ ignored `test-results/`):

| Point | Commits (รวมสอง workspace) | Total relation bytes | snapshots rows | commands rows |
| --- | --- | --- | --- | --- |
| 1 | 0 | 761,856 | 12 | 10 |
| 2 | 16 | 933,888 | 28 | 26 |
| 3 | 32 | 1,105,920 | 44 | 42 |
| 4 | 48 | 1,286,144 | 60 | 58 |

ความชัน = 524,288 bytes / 48 commits ≈ **10,923 bytes ต่อ commit** สำหรับ fixture 20 records; เมื่อรัน
`--records 100` ได้ 786,432 → 1,515,520 bytes (≈ **15,189 bytes ต่อ commit**) แสดงว่าความชันขึ้นกับขนาด
snapshot ไม่ใช่จำนวน run ที่มองเห็น

ข้อจำกัดของการวัด: `pg_total_relation_size` คือ relation bytes (heap + index + TOAST, ปัดขึ้นเป็นหน้า 8 KiB)
**ไม่ใช่** RAM, disk usage, WAL หรือทั้ง database image; เป็น PGlite ในเครื่องที่มี workload สังเคราะห์เท่านั้น
ไม่ใช่ capacity claim ของ D1/Room SQLite/Billing และไม่ได้พิสูจน์พฤติกรรม hosted

## การตรวจ

Node `v22.23.2`, npm `11.0.0` (worktree `feat/F078-T7a-storage-contract`):

- `npm run typecheck` — ผ่าน 3 configs (client build project, `tsconfig.server.json`, `tsconfig.cloudflare.json`)
- `npm run lint` — **0 errors / 111 warnings** (เท่า baseline ของ dev)
- `node node_modules/vitest/vitest.mjs run server/storage-growth.test.ts` — **5 passed (5)**
- `npm test` — **942 passed / 5 skipped (947)** จาก 125 passed + 2 skipped test files หลัง merge dev `bad48d7` (dev 937 + 5 test ใหม่)
- `node --import tsx scripts/storage-growth.ts` — ผ่าน, workload 2×24 commits, 4 points, เขียน JSON 1 ไฟล์ใต้
  `test-results/storage-growth/`; ผลตามตารางด้านบน
- `node scripts/check-public-files.mjs` — **844 files / 0 findings**
- `npx tsx server/changelog.ts check` — **10 fragments OK**
- `git diff --check` — ไม่มี whitespace error

**SKIPPED:** Workers/browser suites และ production/staging deployment — งานนี้แตะเอกสาร สคริปต์วัด และ test
ใหม่เท่านั้น ไม่แตะ request path หรือ schema; CI ของ PR จะรันชุดที่ planner เลือกให้เอง ไม่นับเป็น PASS ของรอบนี้

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-24 | วัดด้วย PGlite in-memory บน dataset สังเคราะห์ ไม่ใช้ DB จริงหรือ hosted | ทำซ้ำได้ ไม่มีความลับ ไม่แตะข้อมูลผู้ใช้ และแยก "วัดได้" ออกจาก "capacity" |
| 2026-10-24 | ระบุ retention/receipt horizon เป็นคำถามเปิด ไม่เลือกตัวเลข | การลบข้อมูลเป็น R0 ต้องมีการอนุมัติ scope/environment และแผนกู้คืนจากคน |
| 2026-10-24 | รายงานความต่างสอง adapter ตามโค้ดจริงแทนการทำให้เหมือนกัน | งานนี้ preserve behavior; การรวม semantics ต้องมี migration/restore plan แยก |

## คำถามเปิด

- Required retention/export horizon ของ receipts, events และ snapshots **ยังไม่ตัดสิน** และเอกสารนี้ไม่อนุมัติ
  การลบ
- Hosted RPO/RTO และ backup primitive ที่ยอมรับได้ของแต่ละ store ยังไม่เลือก
- ใครควรเป็นเจ้าของ consumer ของ `room_artifact_cleanup` ฝั่ง Room
- Room ควรมี database schema version และ additive migration mechanism ก่อนแก้ column ครั้งแรกหรือไม่
