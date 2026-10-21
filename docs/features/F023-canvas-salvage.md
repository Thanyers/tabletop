# F023 — กู้ตารางเมื่อการ์ด canvas ผิดรูป (canvas salvage)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เปลี่ยนพฤติกรรม parse ให้ใจดีกับ view ที่ผิดรูป |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F023-T1` |

## ทำไม

จากเคสจริง (prompt เดียวกัน รันซ้ำ): โมเดลสร้างตารางถูกต้อง แต่ทำ **การ์ดภาพ (scene/view)** ผิดรูปง่าย เช่น
- `Scene text expressions must return text.` (เอา number ไปใส่ text)
- `views[0].elements[3].text` ผิด schema
- `Unrecognized key: "conditionDescription"` ใน controls

เดิม **ผิดใบเดียว = ไม่ activate ทั้งตาราง** ทำให้ผู้ใช้เห็นแต่ "could not complete" (รุ่น 3.0.0) และคิดว่าแอปสุ่ม

## สิ่งที่เปลี่ยน

1. **Provider parse**: ถ้า parse ทั้งก้อนล้ม แต่ core (program ที่ไม่มี canvas) ผ่าน → parse ทีละ view, เก็บใบที่ผ่าน, ทิ้งใบที่ผิด schema แล้วคืนร่างที่กู้ได้ (`parseTableChangeSalvagingCanvas`)
2. **Domain parse (`parseBoundedTableChange`)**: ใช้เส้นทางเดียวกัน
3. **เพดาน depth/nodes ยังบังคับกับ core และ view ที่จะเก็บ** — ไม่ใช่การข้าม limit
4. **Prompt**: ถ้า view เขียนไม่ได้ให้ omit view นั้น; ตอนซ่อมให้คงส่วนที่ผ่านแล้วไว้; เน้นว่า effect/field lookup ต้องอ้าง record parameter และ field ที่ประกาศจริง

## ขอบเขตที่ "ไม่" ผ่อน

- **การผิดเชิงความหมาย/ความปลอดภัยยังปฏิเสธทั้งร่าง** เช่น metric หารศูนย์, scene เกิน element limit, ผูก controls กับ action ที่ไม่มี — คงเทสต์เดิมไว้ครบ
- core ผิด (เช่น effect อ้าง field ที่ไม่มี) ยังซ่อม/ปฏิเสธตามเดิม

## ผลกับผู้ใช้

- ตารางเกิดขึ้นได้แม้การ์ดภาพบางใบ "ผิดรูปแบบ" (การ์ดนั้นถูกข้าม)
- ลดรอบ "สร้างใหม่ทั้งก้อน" ที่ทำให้ issue เปลี่ยนไปเรื่อย ๆ

## ผลตรวจ (Node 22.23.2)

- unit: `table-canvas-salvage.test.ts` 6 เคส (parse ระดับ provider/domain, ตัด view พัง, core ผิดยัง null/throw, depth limit ยังบังคับ)
- regression: `generative.test.ts` + `deepseek-changes.test.ts` ยังผ่านครบ (ความปลอดภัยไม่หาย)
- live (DeepSeek จริง, prompt เดิมจากรายงาน ซึ่งเคยล้ม 3/3 ในตัวอย่าง): หลังแก้ **ผ่านรอบแรก 1 ครั้ง** และอีกรอบผ่านที่ attempt 3 (collections `jar,basket` / `cookies`, views 4–6); อีก sample ชนเพดาน input ตอนซ่อม ซึ่ง production มี fallback ลด previousOutput อยู่แล้ว

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | salvage เฉพาะ **schema ผิดรูป** ไม่กลืน error เชิงความหมาย | รักษา guarantee ด้านความปลอดภัย/เพดาน output ที่เทสต์เดิมคุมไว้ |
| 2026-10-21 | ตัด view ที่พังแบบเงียบ | ผู้ใช้ได้ตารางใช้งานจริงก่อน; ค่อยเพิ่ม notice "ข้ามการ์ดภาพ N ใบ" ภายหลัง |
