# F018 — รักษา canvas views ตอน evolve

| | |
| --- | --- |
| สถานะ | `review` (implement แล้ว, รอ merge) |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เปลี่ยนพฤติกรรม server-side, ไม่มี schema/migration |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F018-T*` |

## ทำไม

เมื่อผู้ใช้ขอแก้กฎ AI มักส่ง program ใหม่ที่ไม่มี view เดิม (chart/metric/scene) ทำให้การ์ดที่ผู้ใช้สร้างหายไปทั้งที่ข้อมูลยังอยู่ — prompt สั่งให้ "Preserve view IDs" แต่ไม่มีอะไรบังคับ

## สิ่งที่ผู้ใช้จะเห็น

- ขอเปลี่ยนกฎบนโต๊ะเดิม → การ์ด/metric/chart ที่มีอยู่ **ไม่หาย** แม้ AI จะไม่ส่งกลับมา
- ถ้า AI ส่ง view เดิมกลับมาเอง (id ซ้ำ) ของใหม่ชนะ
- ถ้า collection/field/action ที่ view อ้างถึงถูกลบ view นั้นถูกตัดทิ้งอย่างปลอดภัย (ไม่ทำให้การแก้กฎล้ม)
- เกินเพดาน 12 views → ไม่เพิ่มเกิน

## ขอบเขต

**รวม:** merge canvas ใน `applyTableChange` (ใช้ร่วม validate/simulate/activate), filter ตาม `validateGenerativeProgram` ของ program ใหม่ + records, เคารพ `GENERATIVE_LIMITS.canvasViews`

**ไม่รวม:** UI ให้ผู้ใช้เลือกว่าจะเก็บ view ใด, การกู้ view ที่ถูกลบโดยเจตนา (ยังไม่มี explicit delete)

## ข้อเท็จจริงจากโค้ด

- `src/tabletop/runtime/generative/preserve.ts` (ใหม่) — `preserveCanvasViews(previous, next, program, records)`
- `src/tabletop/domain/table.ts` — hook ก่อน `validateGenerativeProgram` ใน `applyTableChange`
- `src/tabletop/ui/canvas-layout.ts` — ตำแหน่งการ์ดยังกรองตาม id ที่มีอยู่ จึงไม่ต้องแก้

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | `preserveCanvasViews` + unit tests | view ถูกพากลับ, ไม่ซ้ำ, ตัด view ที่ bind ไม่ได้, เคารพเพดาน |
| T2 | hook ใน `applyTableChange` + domain test | rule edit ที่ไม่มี canvas ยังได้ view เดิม |
| T3 | เอกสาร/CHANGELOG | อัปเดตครบ |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | merge ที่ server (`applyTableChange`) ไม่ใช่ prompt | prompt ไม่ใช่การบังคับ; server เป็น authority ของ program |
| 2026-10-21 | validate view ที่จะพากลับทีละใบกับ program ใหม่ | กันการพา view ที่อ้างของที่ถูกลบ จนการแก้กฎล้มทั้งก้อน |
