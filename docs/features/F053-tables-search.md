# F053 — ค้นหาโต๊ะ + เวลาอัปเดตล่าสุดในหน้า `/tables`

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เพิ่มฟิลด์ optional ใน `SessionView` และ header ภายใน ไม่มี schema/migration/binding · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F053-T*` |

## ทำไม

หน้า `/tables` (F004) แสดงทุกโต๊ะเรียงตาม id ไม่มีทางหาโต๊ะเร็ว ๆ และไม่รู้ว่าโต๊ะไหนเพิ่งมีการเปลี่ยน

## สิ่งที่ผู้ใช้จะเห็น

1. ช่อง **Search tables** ข้างหัวข้อ (แสดงเมื่อมีมากกว่า 1 โต๊ะ) ค้นจากชื่อโต๊ะ ชนิดโต๊ะ และ role · ทุกคำต้องเจอ ไม่สนลำดับ · ไม่สนตัวพิมพ์และวรรณยุกต์ละติน แต่คงสระ/วรรณยุกต์ไทย · Esc ล้างช่อง · ไม่เจอแสดง "No tables match …"
2. แต่ละแถวมี **Updated 5 minutes ago** (ชี้ค้างเห็นวันเวลาเต็ม)
3. เรียง: โต๊ะที่เปิดล่าสุดก่อน แล้วตามเวลาอัปเดตใหม่ → เก่า

## ข้อเท็จจริงจากโค้ด (2026-10-22)

- "อัปเดต" = เวลาของคำสั่งล่าสุดที่ commit ใน epoch ปัจจุบัน (`MAX(room_events.created_at)`) รวมการย้ายการ์ด (`canvas.layout`) เพราะเป็นตำแหน่งที่ทุกคนเห็นร่วมกัน (F007) · ยังไม่มีคำสั่งเลยใช้ `createdAt`
- แชท AI ที่ไม่ได้เปลี่ยนโต๊ะไม่นับ (ไม่ได้อยู่ใน `room_events`)
- Room ส่งเวลาใน header `x-tabletop-updated-at` ของ `/internal/view` · `WorkspaceView` ไม่เปลี่ยน · Worker ใส่ `updatedAt` ใน `SessionView.workspaces`
- Node runtime (`npm start`) ยังไม่ส่ง `updatedAt` แถวจึงไม่มีเวลาและเรียงตามเดิม

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | Room → Worker → `SessionView.updatedAt` | `cloudflare/room.test.ts` (F053) ผ่าน |
| T2 | ช่องค้นหา + เวลา + การเรียงในหน้า `/tables` | unit `relative-time.test.ts` ผ่าน · ทดสอบมือบน Worker emulator |
| T3 | Node runtime ส่ง `updatedAt` | ยังไม่ทำ (ไม่ใช่เส้นทาง production) |
