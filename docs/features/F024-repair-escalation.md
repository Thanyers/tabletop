# F024 — ซ่อมร่างกฎที่ล้มซ้ำเรื่องเดิม (repair escalation)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — ปรับพฤติกรรม repair loop (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F024-T1` |

## ทำไม

จากชุดทดสอบโจทย์แปลก 10 เคส (AI จริง, โค้ด 3.3.0): เคสมังกร 3 หัว ล้ม **3/3 รอบ** ด้วย issue เดิม ๆ (`An action refers to an unknown record field.`) และเคสมัดจำ 20% ก็วน issue คล้ายกัน — โมเดลพยายามแก้แต่กลับสร้าง reference ใหม่ที่ผิดซ้ำ

## สิ่งที่เปลี่ยน

- `cloudflare/repair.ts` (ใหม่): `nextRepairIssues(previous, issues)` — ถ้า issue แรกของรอบใหม่ **ซ้ำกับรอบก่อน** จะเติม directive:
  *"The same validation issue repeated. Simplify the design: remove the action or view that causes it instead of adding new fields or references."*
- `cloudflare/ai.ts`: เก็บ issue ของรอบก่อน แล้วใช้ `nextRepairIssues` ตอนสร้างคำขอซ่อม (สูงสุด 4 issue เหมือนเดิม)

## ผลทดสอบ (AI จริง, prompt เดิม)

| เคส | ก่อน | หลัง |
| --- | --- | --- |
| มังกร 3 หัว (HP ต่อหัว, ผลัดกันโจมตี) | rejected 3/3 (issue เดิมวน) | **ACCEPTED** attempt 3 (escalation ทำงาน; `heads,hero` + strike/breath/restore) |
| มัดจำ 20% (คำนวณอัตโนมัติ) | rejected 3/3 | **ACCEPTED** attempt 2 (`deposits` + add/update actions) |

## ผลตรวจ (Node 22.23.2)

- `npm run typecheck` ผ่าน · `npm test` **455/455** · `npm run test:cloudflare` **97/97**
- unit ใหม่: `cloudflare/repair.test.ts` 3 เคส (ซ้ำ → directive, ต่าง → ไม่เติม, cap 4)

## ข้อจำกัด

- เป็นการ "บอกให้ลดความซับซ้อน" ไม่ใช่รับประกันว่าโมเดลจะทำตามทุกครั้ง
- เคสที่ยังล้ม: ถ้าโมเดลตอบ JSON ขาด/ใหญ่เกินจนซ่อมไม่ทัน 25s deadline (production มีการ trim excerpt แล้ว)
