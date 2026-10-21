# F015 — นำแถวข้อมูลเข้าตารางโดยตรง (CSV → records)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เพิ่มคำสั่งใหม่, ไม่มี migration/secret/binding |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F015-T*` |

## ทำไม

วันนี้ไฟล์ CSV ต้องผ่าน AI แปลงเป็น program ใหม่ทั้งตาราง (ช้ากว่า, มี consent, และเสี่ยง validation ล้ม) ทั้งที่ผู้ใช้แค่อยากเอาแถวเข้าตารางเดิม — POC เคยพิสูจน์ว่า import ตรงเป็น deterministic และตอบโจทย์ "แนบไฟล์ทีหลัง" ได้จริง

## สิ่งที่ผู้ใช้จะเห็น

1. เปิดการ์ดข้อมูลบน Canvas แล้วเลือก **Import rows**
2. เลือก collection, วาง CSV หรือเลือกไฟล์ (≤32 KiB)
3. เห็น preview: จำนวนแถวที่ใช้ได้/ผิด, การจับคู่คอลัมน์ → field
4. กด **Import** → แถวเข้าตารางทันทีโดยไม่เรียก AI และไม่ถาม consent
5. ถ้ามีแถวผิดหรือชน unique → ไม่ import เลย (all-or-nothing) พร้อมบอกแถวที่ผิด

_(UI ทำแล้วใน PR เดียวกัน: ปุ่ม Import rows ในการ์ด collection แบบขยาย)_

## ขอบเขต

**รวม:** คำสั่ง `table.importRows` (owner เท่านั้น), ตรวจชนิด/required/choices/min/max, เติม default, ตรวจ unique invariant, จำกัด 100 แถว/คำสั่ง และเพดานเดิม (100 แถว/collection, 200 แถว/ตาราง, 128 KiB), activity log, actionRevision/dataRevision เพิ่ม

**ไม่รวม:** การแก้ schema ระหว่าง import, replace/merge ที่ลบแถวเดิม, การ import ข้ามหลาย collection ในคำสั่งเดียว, การ parse CSV ฝั่ง server (client parse แล้วส่งค่าที่ normalize แล้ว; server ตรวจซ้ำแบบ strict)

## ข้อเท็จจริงจากโค้ด

- `src/tabletop/domain/table.ts` — `handleTableCommand` เพิ่ม branch `table.importRows`; ใช้ `validValue`, `checkRows` (รวม invariant), `validateGenerativeOutput`
- `server/authority.ts` — whitelist ตารางเพิ่ม `table.importRows`
- เทสต์: `src/tabletop/domain/table-import.test.ts`

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | คำสั่ง `table.importRows` + authority whitelist + unit tests | เทสต์ domain ผ่าน, typecheck ผ่าน |
| T2 | UI: การ์ด Import rows + CSV parse/preview/mapping | กดใช้ได้จริงบน browser |
| T3 | browser acceptance + เอกสาร/Welcome | ผ่าน CI และคู่มือผู้ใช้ |

## คำถามเปิด

- สมาชิก (participant) ควร import ได้หรือไม่ — รอบนี้ owner เท่านั้น (F008 ให้สมาชิกเพิ่ม "ไฟล์" ได้ แต่การเพิ่มแถวเข้า shared data เป็นการเปลี่ยนข้อมูล)
- ต้องรองรับการอัปเดตแถวเดิม (upsert ด้วย key) หรือไม่ — รอบนี้ append เท่านั้น

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | client parse CSV, server ตรวจค่าที่ normalize แล้วซ้ำแบบ strict | ลด surface ของ parser ฝั่ง server; server ยังเป็น authority ของชนิด/ขีดจำกัด |
| 2026-10-21 | owner-only และ append-only | ลดความเสี่ยงข้อมูลถูกเขียนทับ; ต่อยอด replace/upsert ได้ภายหลังโดยไม่เปลี่ยน contract หลัก |
