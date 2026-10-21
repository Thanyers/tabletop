# F028 — fallback ตารางขั้นต่ำ (ซ่อมตัวเองรอบสุดท้าย)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เพิ่มความพยายามครั้งที่ 4 ใน repair loop (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F028-T1` |

## ทำไม

จากเทสจริง 10 เคสบน production: เคส join ข้ามการ์ดถูก **reject** หลังซ่อม 3 รอบ เพราะโมเดลพยายามทำสิ่งที่ DSL ทำไม่ได้ (อ้างข้าม collection) — ผู้ใช้ไม่ได้ตารางเลยทั้งที่ส่วนอื่นทำได้

## สิ่งที่เปลี่ยน

- `cloudflare/repair.ts`: `FALLBACK_SIMPLIFY_ISSUES` — directive ขอ **ตารางเล็กสุดที่ยังตอบโจทย์**: 1 collection ≤4 fields, ≤1 action, **ไม่มี canvas**, ไม่มี cross-collection lookup
- `cloudflare/ai.ts`: `MAX_ATTEMPTS = 4`; รอบที่ 4 (หลังซ่อม 3 รอบล้ม) ใช้ fallback directive แทนการซ้ำ issue เดิม; ถ้ารอบนี้ผ่าน → ได้ draft, ถ้าไม่ผ่านจึง reject พร้อม reasons (F016)
- ไม่เพิ่ม output/ต้นทุนเมื่อ draft ผ่านในรอบปกติ (เรียกครั้งที่ 4 เฉพาะตอนล้มเท่านั้น)

## ผลกับผู้ใช้

- เคสที่ "เกือบได้" (เช่น join) มีโอกาสได้ตารางแบบง่ายที่ใช้งานได้ แทนการไม่ได้อะไรเลย
- ถ้าโจทย์เกิน DSL จริง ๆ ยังได้ reject พร้อมเหตุผล + hint (F027)

## ผลตรวจ (Node 22.23.2)

- unit: `cloudflare/repair.test.ts` เพิ่ม 1 เคส; `cloudflare/ai.test.ts` เพิ่มเคส "falls back to the smallest valid table" และปรับเคส cap เป็น 4 ครั้ง — ผ่าน
- live (DeepSeek จริง, เคส join ที่เคย rejected 3/3 บน production): **ผ่านที่ attempt 2** (collections `products,supplier_cards`, actions `add_product,add_supplier_card,link_cost`, views 3) — ไม่ต้องใช้ fallback เลยในรอบนี้ แต่ fallback พร้อมเป็นตาข่ายชั้นสุดท้าย

## ข้อจำกัด

- ต้นทุนเพิ่มเฉพาะเคสที่ล้ม (สูงสุด 4 calls); deadline รวม 25s ยังบังคับ
- fallback เป็น directive ไม่ใช่ AST surgery — ถ้าโมเดลยังตอบเกิน DSL จะยัง reject
