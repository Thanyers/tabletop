# F029 — golden corpus + วัด success rate

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เครื่องมือวัดผล (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F029-T1` |

## ทำไม

ก่อนหน้านี้เราวัด "บางทีได้บางทีไม่ได้" ด้วยมือทีละเคส — ไม่มีตัวเลข baseline ทำให้ตัดสินไม่ได้ว่า F023/F024/F025/F028 ช่วยจริงแค่ไหน

## สิ่งที่เพิ่ม

- `tests/corpus/table-prompts.json`: 10 โจทย์จริง (5 คาดว่าได้ draft, 5 คาดว่า clarify) พร้อม `expect`
- `server/corpus-success-rate.test.ts`: รัน corpus ผ่าน provider จริง + validator + repair loop 4 รอบ (เหมือน production) แล้วสรุป `draft/clarify/reject/error` + `matched` และเขียนรายงาน Markdown ลง `test-results/corpus/`
  - **skip อัตโนมัติใน CI** (`describe.skipIf(!TABLE_CORPUS_KEY)`) — ต้องมี key จริงจึงรัน
  - วิธีรัน: ตั้ง `TABLE_CORPUS_KEY` แล้ว `npx vitest run server/corpus-success-rate.test.ts`

## Baseline ครั้งแรก (2026-10-21 20:21, Node 22.23.2, โค้ด dev หลัง F028)

| ตัวชี้วัด | ค่า |
| --- | --- |
| matched กับ expectation | **9/10** |
| draft | 4 (basket 2 รอบ, deposit 2, emoji 1, dragon 2) |
| clarify | 5 (ทุกเคสรอบแรก) |
| reject | 1 (join — 4 รอบ) |
| error | 0 |
| เวลารวม | ~62s (10 เคส) |

> หมายเหตุ: join ให้ผลไม่คงที่ (รอบ live ก่อนหน้าผ่าน attempt 2; corpus นี้ reject) — ตัวเลขนี้คือเหตุผลที่ต้องมี corpus วัดซ้ำ ไม่ใช่ตัดสินจากเคสเดียว

## ผลกับทีม

- ใช้เป็นเกณฑ์ก่อน/หลังแก้ทุกครั้ง (F023→F028) และก่อนออก release
- เพิ่มเคสใหม่ได้โดยแก้ JSON อย่างเดียว

## ข้อจำกัด

- ใช้ key จริง (มีค่าใช้จ่าย) และผลขึ้นกับโมเดล/timeout — ต้องดูแนวโน้มหลายรอบ ไม่ใช่รอบเดียว
- ยังไม่ผูกเข้า CI (ตั้งใจ) เพื่อไม่ให้ CI เรียก AI
