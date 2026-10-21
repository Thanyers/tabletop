# F017 — คอลัมน์คำนวณ (computed columns)

| | |
| --- | --- |
| สถานะ | `doing` (จองงานแล้ว, ยังไม่เขียนโค้ด) |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | **MAJOR (ต้องเคาะก่อน)** — เพิ่ม key ใน `TableField`; writer รุ่นก่อน (≤3.0.0) ใช้ `strictObject` จึงอ่าน program ที่มี `computed` ไม่ได้ → rollback หลังบันทึกจะไม่ได้ |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F017-T*` |

## ทำไม

ผู้ใช้ต้องคำนวณยอดรวม/ส่วนต่าง/คงเหลือเอง หรือให้ AI สร้าง view ใหม่ทั้งก้อน ทั้งที่เป็นสูตร deterministic — POC พิสูจน์ว่า host-side formula (AST ไม่ใช้ `eval`) ให้ผลทันทีและไม่เปลือง AI

## สิ่งที่ผู้ใช้จะเห็น

1. ตารางมีคอลัมน์ที่คำนวณอัตโนมัติ เช่น `total = qty × price` (แสดงพร้อม badge ว่าเป็นค่าคำนวณ)
2. แก้แถว/เพิ่มแถว → ค่าคำนวณอัปเดตทันที ไม่เรียก AI
3. แก้สูตรได้ผ่าน Rules (ภายหลัง) โดยไม่ต้องให้ AI ร่างใหม่ทั้งตาราง

## ขอบเขต

**รวม:** `TableField.computed?: GenerativeExpression` (เฉพาะ field ชนิด `number`, ผลเป็น number), validation: type/cycle/bounds/fuel, ประเมินตอน projection ต่อแถวด้วย AST เดิม, UI แสดง read-only, action/effects/creates ห้ามเขียนทับ field คำนวณ, unit tests

**ไม่รวม:** aggregate/rollup ข้าม collection, การแก้สูตรผ่าน UI เต็มรูปแบบ (ทำใน T4 ถ้าทัน), การเก็บค่าลง records, การเปลี่ยนชนิด field เดิม

## ข้อเท็จจริงจากโค้ด

- `src/tabletop/domain/table.ts` — `fieldSchema` เป็น `z.strictObject`; `value` ตรวจชนิด; `checkProgram` ตรวจ program
- `src/tabletop/runtime/generative/*` — มี AST + evaluator + fuel/bounds อยู่แล้ว (ใช้ใน canvas/operand)
- projection/UI: `src/tabletop/ui/TableCanvasObjects.tsx` แสดง `record.values` ตรง ๆ
- POC reference: `poc/src/formula.ts` (AST, หารด้วยศูนย์ → 0), `poc/src/engine.ts` (ลำดับ apply → rollup → formula)

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | contract + schema + validation (cycle/type/bounds) + unit tests | program ที่ผิดถูกปฏิเสธ; program เก่ายังผ่าน |
| T2 | evaluate per-row ที่ projection (ไม่เขียนลง records) + tests | ค่าคำนวณถูกต้องและไม่เปลี่ยน `dataRevision` |
| T3 | UI: คอลัมน์ read-only + badge, ปฏิเสธการเขียนทับ | browser check ผ่าน |
| T4 | (ถ้าทัน) แก้สูตรผ่าน Rules; เอกสาร/คู่มือ | ผ่าน CI + คู่มือ |

## คำถามเปิด

- **เวอร์ชัน:** จะยอมรับ MAJOR ในรอบถัดไป หรือรอรวมกับการเปลี่ยน contract อื่น (เช่น preserve views) เพื่อออกรุ่นเดียว?
- ผู้ใช้ควรแก้สูตรเองได้ในรอบแรก หรือให้ AI ร่างสูตรให้ก่อน (ลด surface ของ UI)?
- ค่าคำนวณควรใช้ในเงื่อนไข/ผลของ action ได้หรือไม่ (อ่านได้ แต่เขียนไม่ได้)?

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | คำนวณตอน projection ไม่เก็บลง records | รักษา revision/CAS และไม่ต้อง migration; POC ทำแบบนี้ |
| 2026-10-21 | reuse AST เดิม ไม่สร้าง grammar ที่สอง | ลดsurface และได้ bounds/fuel ที่มีอยู่แล้ว |
| 2026-10-21 | ยังไม่เริ่มโค้ดจนเจ้าของเคาะระดับรุ่น | การเพิ่ม key ทำให้ writer เก่าอ่านไม่ได้ (rollback rule) |
