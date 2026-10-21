# F027 — reject บอกเหตุผลเชิงโครงสร้าง (cross-collection)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — ปรับข้อความ (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F027-T1` |

## ทำไม

เคส join ข้ามการ์ด (production 3.3.1) ถูก reject ด้วย *"The AI did not return a complete draft."* ซึ่งจริงแต่ไม่บอกว่า**ระบบยังไม่รองรับการอ้างข้าม collection** ผู้ใช้จึงไม่รู้ทางไปต่อ

## สิ่งที่เปลี่ยน

- `cloudflare/model-failure.ts`: ถ้า reason ที่จะแสดงมีคำว่า `unknown record field` / `unknown field` / `cross-collection` / `join` / `lookup` → เติมประโยค
  *"This table cannot join rows across collections yet; keep the data in one collection or attach a CSV file."*
- ใช้กับทั้ง `MODEL_PROVIDER_OUTPUT_REJECTED` และ `TABLE_*` (ข้อความเดียวกับที่ F016 แสดง)

## ผลกับผู้ใช้

- เห็นทั้ง **สาเหตุจริง** (จาก F016) และ **ข้อจำกัดเชิงโครงสร้าง + ทางเลือก** (F027) ในข้อความเดียว

## ผลตรวจ (Node 22.23.2)

- unit: `cloudflare/model-failure.test.ts` เพิ่ม 2 เคส (เติม hint เมื่อ reason เป็น unknown record field; ไม่เติมเมื่อ reason อื่น) — ผ่าน
- ไม่มี migration/secret/binding

## ข้อจำกัด

- เป็นการ match คำใน reason ไม่ใช่การวิเคราะห์ AST; ถ้าโมเดลเขียน reason คนละถ้อยคำ hint อาจไม่ขึ้น (แต่ข้อความ reject ยังบอก reason จริง)
