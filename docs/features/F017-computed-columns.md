# F017 — คอลัมน์คำนวณ (computed columns)

| | |
| --- | --- |
| สถานะ | `review` — implement แล้ว (T1–T3), รอ merge |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | **MINOR** — เก็บนิยามใน `TableState.computedColumns` (ไม่แตะ program schema) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F017-T*` |

## ทำไม

ผู้ใช้ต้องคำนวณยอดรวม/ส่วนต่าง/คงเหลือเอง หรือให้ AI สร้าง view ใหม่ทั้งก้อน ทั้งที่เป็นสูตร deterministic — POC พิสูจน์ว่า host-side formula (AST ไม่ใช้ `eval`) ให้ผลทันทีและไม่เปลือง AI

## สิ่งที่ผู้ใช้จะเห็น

1. ตารางมีคอลัมน์คำนวณอัตโนมัติ เช่น `total = qty × price` (badge ว่าเป็นค่าคำนวณ)
2. แก้แถว/เพิ่มแถว/import → ค่าคำนวณอัปเดตทันที ไม่เรียก AI
3. owner กำหนด/แก้สูตรได้ (ผ่านคำสั่งของโต๊ะ) โดยไม่ต้องให้ AI ร่างใหม่ทั้งตาราง

## ผลการ timebox: หา encoding ที่ไม่ทำ contract พัง

| ทางเลือก | ผล | สรุป |
| --- | --- | --- |
| เพิ่ม `TableField.computed` | `fieldSchema` เป็น `z.strictObject` → writer ≤3.0.0 อ่าน program ไม่ได้ | **ตัดทิ้ง** (MAJOR) |
| เพิ่ม descriptor kind/property | `GenerativeViewDescriptor` เป็น union ปิด + strict | **ตัดทิ้ง** (MAJOR) |
| เก็บใน `program.assumptions` แบบ prefix | เก่าไม่พัง แต่ปนกับข้อสมมติของ AI และโผล่ใน UI | **ไม่แนะนำ** |
| **เก็บใน `TableState.computedColumns`** | state ไม่ถูก zod ตรวจตอนโหลด; `applyTableChange` คืน `{ ...structuredClone(state), ... }` จึงเก็บ key นี้ไว้; writer เก่าเมิน key แปลกและไม่ crash | **เลือกทางนี้** |

**เหตุผลด้าน rollback:** rollback ไป 3.0.0 แล้วข้อมูลไม่เสีย — คอลัมน์คำนวณแค่ไม่แสดง (feature hidden) ไม่มี schema/migration และไม่ทำให้ห้องอ่านไม่ได้

## ขอบเขต

**รวม:** `TableState.computedColumns?: ComputedColumn[]` (`{ id, collection, label, expression: GenerativeExpression }`), คำสั่ง owner-only `table.setComputedColumns` (validate: collection มีจริง, field ที่อ้างมีจริง, ผลเป็น number, ไม่มี cycle, bounds/fuel), ประเมินตอน projection ต่อแถว, UI read-only + badge, ปฏิเสธการเขียนทับจาก effects/creates, unit tests

**ไม่รวม:** aggregate/rollup ข้าม collection, การเก็บค่าลง records, การแก้สูตรผ่าน Rules UI เต็มรูปแบบ (T4), การเปลี่ยนชนิด field เดิม

## ข้อเท็จจริงจากโค้ด

- `src/tabletop/domain/table.ts` — `fieldSchema` strict (ห้ามแตะ); `applyTableChange` spread state (เก็บ key แปลก); `checkProgram` ตรวจ program
- `src/tabletop/runtime/generative/*` — AST + evaluator + fuel/bounds พร้อมใช้ (op `field`, `literal`, `if`, arithmetic)
- projection/UI: `src/tabletop/ui/TableCanvasObjects.tsx` แสดง `record.values` ตรง ๆ → ต้องเพิ่มค่าคำนวณตอน render
- POC reference: `poc/src/formula.ts`, `poc/src/engine.ts`

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | ✅ `TableState.computedColumns` + คำสั่ง `table.setComputedColumns` + validation + unit tests (`computed-columns.test.ts`, `table-computed.test.ts`) | program เก่า/ใหม่ทำงานเหมือนเดิม; คำสั่งผิดถูกปฏิเสธ |
| T2 | ✅ ประเมินต่อแถว (`computeRecordRow`) ตอน projection ไม่เขียน records/ไม่ bump dataRevision | ค่าถูกต้องตาม AST; ไม่มี eval |
| T3 | ✅ UI: คอลัมน์ read-only + badge, editor ของ owner (label/field/operator/value), browser check ใน `generic-table-browser.mjs` | browser ผ่าน |
| T4 | ⏳ (ภายหลัง) แก้สูตรผ่าน Rules + คู่มือผู้ใช้ | ผ่าน CI + คู่มือ |

## ผลตรวจ (Node 22.23.2)

- `npm run typecheck` ผ่าน
- `npm test` **432/432** (เพิ่ม 8: shared 4 + domain 4)
- `npm run build` + `npm run build:cloudflare` ผ่าน
- `node tests/cloudflare-browser.mjs` **ผ่าน** — owner สร้างคอลัมน์ "Score plus 5" (score + 5), API มี `computedColumns` 1 รายการ, ตารางแสดง columnheader + ค่า 5 สองแถว

## คำถามเปิด

- ผู้ใช้ควรแก้สูตรเองในรอบแรก หรือให้ AI ร่างสูตรให้ก่อน (ลด surface ของ UI)?
- ค่าคำนวณควรใช้ในเงื่อนไข/ผลของ action ได้หรือไม่ (อ่านได้ แต่เขียนไม่ได้)?

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | เก็บนิยามใน `TableState.computedColumns` ไม่ใช่ program | ไม่ทำ program schema พัง, rollback ได้, ไม่ต้อง migration; ยอมรับว่านิยามไม่อยู่ใน candidate/approval flow (มีผลแค่การแสดงผล) |
| 2026-10-21 | คำนวณตอน projection ไม่เก็บลง records | รักษา revision/CAS และไม่ต้อง migration |
| 2026-10-21 | reuse AST เดิม ไม่สร้าง grammar ที่สอง | ได้ bounds/fuel ที่มีอยู่แล้ว |
