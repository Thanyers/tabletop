# F080 handoff — สถานะ ณ 2026-10-26 (dev `e87d938`)

เอกสารนี้สรุปสิ่งที่ทำเสร็จ มีหลักฐานอะไร และอะไรคือขั้นต่อไป точно ๆ สำหรับคนหรือ AI ที่รับงานต่อ

## 1. สถานะ acceptance

**32 PASS / 2 PARTIAL / 1 UNVERIFIED** จาก 35 รายการ (รายละเอียดรายข้อพร้อมหลักฐานอยู่ใน [acceptance.json](acceptance.json))

| รายการ | สถานะ | ติดอะไร |
|---|---|---|
| G1-01 | PARTIAL | ทุกอย่างหลัง model reply พิสูจน์แล้ว (AI route ในเบราว์เซอร์, adapter 8/8, pipeline 2/2) — **ยังไม่มีการเรียกโมเดลจริง** เพราะไม่มี `DEEPSEEK_KEY` |
| EDIT-01 | PARTIAL | การแก้ต่อบน version ที่ activate พิสูจน์ถึงขอบเขตการเรียก pipeline (browser driver 10/10) — ยังไม่มีการให้โมเดลจริงเห็น source ที่แก้ |
| HUMAN-01 | UNVERIFIED | ต้องมีผู้ใช้จริง 5 คน เว้น 3 วัน · kit + ตัวตรวจผลพร้อมแล้ว |

## 2. สิ่งที่ทำเสร็จ (merged เข้า `dev`)

| ด้าน | สิ่งที่มีจริง | หลักฐาน |
|---|---|---|
| Tool package + host | sandboxed iframe, typed bridge, compile adapter | host driver **16 checks** — cookie/storage/fetch ถูกบล็อก, origin = null |
| Authoring | human + AI route ใน pipeline เดียว, แก้ source → activate → readback | authoring driver **10 checks** (รวม AI route + EDIT-01 continuation) |
| Collaboration space | grants, live revision, revoke, action + replay, export, copies | cross e2e **32+ tests**, room suite **62** |
| Room shell | variant C + product screen แสดง tool ที่ติดตั้ง | room-shell driver **7 checks**, ui-gate **17/17** |
| Tool ในห้อง | install reference + definition (hash พิสูจน์โดย Worker) + **intent route** ที่รัน behaviour จริงแล้ว commit ผ่าน `table.act` | `tool-intent.test.ts` **6/6** (รวม drift test ของ refusal codes), install-verify 6/6 |
| EXEC-01 | behaviour รันใน isolate → validate → plan → commit | e2e ผ่าน `buildToolBehaviorRequest` จริง **2 เคส** (commit จริง + ปฏิเสธแบบ zero write) |

**ตัวเลขรวมบน dev:** unit **1221+ passed / 5 skipped** · Worker tier **325+/341** (เติบโตตามงานที่เพิ่ม) · typecheck 3 config · public scan 0 findings

## 3. ขั้นต่อไปที่ชัดเจน (เรียงตามลำดับที่ควรทำ)

### 3.1 ปิด G1-01 / EDIT-01 (ต้องการ key เท่านั้น)
1. สร้าง `.dev.vars` ที่ราก worktree: `DEEPSEEK_KEY=<key เดิม>` (ไฟล์นี้ gitignore ไว้)
2. รัน `npx tsx server/providers/author-tool-package-cli.ts "<intent>"` — CLI บังคับเพดาน ≤6 calls / ≤USD 0.20 และพิมพ์ `withinCap`
3. ใช้ `--base <package.json>` สำหรับ EDIT-01
4. บันทึก `calls / usd / withinCap` ลง `acceptance.json` ของสองข้อนั้น

### 3.2 Mount `GeneratedToolHost` ในหน้าห้อง (slice 3 ของ D-038)
โค้ดฝั่ง server พร้อมแล้ว (intent route) สิ่งที่เหลือคือ UI:
- `SpaceRoomScreen`: เพิ่ม dep `runToolIntent` ที่เรียก `POST /api/workspaces/:id/space/tool/intent`, compile `space.tool.definition` ด้วย `compileToolPackage(definition, () => space.tool.contentHash)` และ render `GeneratedToolHost` ในช่อง `tool` เมื่อมี definition (ไม่มีการ์ดเมื่อ mount host ได้)
- `ports` snapshot มาจาก `JoinedProjectionView` ที่มีอยู่แล้ว; `presentation` ตาม token ของ repo
- harness `?screen=space` ต้องเห็น frame ของ tool; เพิ่ม ui-gate + driver check
- **ห้าม** ให้ `onIntent` เขียนเอง: ต้องเรียก route เท่านั้น (ทางเขียนเดียว)

### 3.3 HUMAN-01
ใช้ [`human-01-kit/README.md`](human-01-kit/README.md) + `scripts/check-human-01-results.mjs` — แม่แบบที่ยังไม่กรอกจะ FAIL เสมอโดยตั้งใจ

### 3.4 Hosted gate
`node scripts/verify-host.mjs --url https://tabletop-staging.ptchrr.workers.dev` → **9 PASS / 0 FAIL / 2 SKIPPED** (SKIPPED = flow ที่ต้องมี session) · ขั้นที่เหลืออยู่ใน [staging-verification.md](staging-verification.md)

## 3.5 สถานะล่าสุดของ D-038…D-041 (สำคัญกว่าหัวข้อ 3.2 ด้านบน)

| รายการ | สถานะจริง |
|---|---|
| D-038 server (intent route) | **merge แล้ว** — `POST /api/workspaces/:id/space/tool/intent` รัน behaviour ใน isolate → validate → plan → commit ผ่าน `table.act` (tool-intent 6/6) |
| D-039 (behaviour ส่ง proposal ได้) | **merge แล้ว** — ABI `{ changes, proposal }` + validator ตรวจ (33/33) |
| D-040 (refusal vocabulary) | **merge แล้ว** — code ที่ route คืนอยู่ใน `TOOL_INTENT_REJECTIONS` + drift test |
| D-038 UI (mount host) | **draft PR #356 พร้อม merge** เมื่อตัดสิน CSP — driver 12 checks, ui-gate 17/17, watchdog 5/5 |
| D-041 (CSP) | **รอเจ้าของตัดสิน** — frame `about:srcdoc` สืบทอด `script-src 'self'` และ bootstrap เป็น inline ⇒ ถูกบล็อกบนหน้าที่ deploy จริง |

⇒ ข้อ 3.2 ด้านบน (mount host) **ทำเสร็จแล้ว** เหลือเพียงการตัดสิน CSP; และข้อจำกัดนี้ถูกบันทึกไว้ใน limitation ของ ISO-01/EXEC-01/G1-03 แล้ว

## 4. ข้อควรระวังที่เรียนรู้มาแล้ว (บันทึกใน MEMORY/decisions)

- `gh` มีสองบัญชีในเครื่อง — ถ้าเจอ "does not have the correct permissions" ให้ `gh auth switch --user Thanyers` (ดู MEMORY)
- run บน `dev` ที่ขึ้น `cancelled` เป็นปกติของ concurrency (CD002) ไม่ใช่ failure
- `resourceSchema` เป็น **required** ของ `buildToolBehaviorRequest`
- `compileToolPackage` hash callback ต้องได้ **canonical string** ตรง ๆ (ไม่ใช่ `JSON.stringify`)
- อย่า mount UI ที่ยังไม่มีทางทำงานจริง — บันทึกเป็น decision แทน
