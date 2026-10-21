# F016 — แสดงสาเหตุจริงเมื่อร่างกฎไม่ผ่านการตรวจ

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | Claude Code |
| เวอร์ชันที่คาด | PATCH — เปลี่ยนเฉพาะข้อความแจ้งผล ไม่เปลี่ยน JSON ของกฎ rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F016` |

## ทำไม

เมื่อร่างกฎจาก AI ไม่ผ่านการตรวจ ทุกกรณีขึ้นข้อความเดียวกัน "The proposed table rules did not pass validation…" ผู้ใช้และทีมไม่รู้ว่าผิดตรงไหน (ต้องเก็บ field เดิม, เกินจำนวนแถว, ค่านอกช่วง ฯลฯ) และ Worker logs ปิดอยู่

## สิ่งที่ผู้ใช้จะเห็น

การ์ดคำตอบขึ้น "did not pass validation:" ตามด้วยสาเหตุจริงไม่เกิน 3 ข้อ เช่น `A rule edit must retain every current field definition.` แล้ว "Revise the request and try again."

## ขอบเขต

**รวม:** ร่างกฎที่ AI ซ่อมครบ 3 รอบแล้วยังไม่ผ่าน (`MODEL_PROVIDER_OUTPUT_REJECTED`) และ `TABLE_*` ที่เกิดตอนนำร่างไปใช้
**ไม่รวม:** ความล้มเหลวอื่น (budget, quota, provider, timeout) ยังใช้ข้อความเดิมและไม่เปิดเผยรายละเอียดจาก provider

## การทำงาน

- `cloudflare/model-failure.ts` (ย้ายจาก `room.ts`): `ReasonedDomainError`, `cleanReasons` (สูงสุด 3 ข้อ, ข้อละ ≤ 240 ตัวอักษร, ตัด control character, บรรทัดเดียว, ไม่ซ้ำ), `safeModelFailureReasons`, `modelFailureMessage`
- `cloudflare/ai.ts`: เมื่อซ่อมครบแล้วยังไม่ผ่าน โยน `ReasonedDomainError` พร้อม `issues` รอบสุดท้าย
- `cloudflare/room.ts` + `room-repository.ts`: เก็บ `reasons` ไว้ใน `data` ของ model job ที่ล้ม แล้วประกอบเป็น `message` ตอน poll · API ไม่เปลี่ยนรูป (`message` เดิม)
- job มองเห็นเฉพาะคนที่ขอ และสาเหตุเป็นเรื่องของโต๊ะของคนนั้นเอง

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | ใส่สาเหตุใน `message` ไม่เพิ่ม field ใหม่ใน API | client แสดง `message` อยู่แล้ว ไม่ต้องแก้ UI และ rollback ได้ทันที |
| 2026-10-21 | แสดงเฉพาะ validation failure | ข้อความของ provider/billing อาจมีรายละเอียดภายใน เทสต์เดิมยืนยันว่าไม่หลุด |
