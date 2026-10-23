# F053 — วันที่สร้าง/วันที่อัปเดต + การเรียง + ค้นหา/ฟิลเตอร์ในหน้า `/tables`

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เพิ่มฟิลด์ optional ใน `SessionView` และ header ภายใน ไม่มี schema/migration/binding · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F053-T*` |

## ทำไม

หน้า `/tables` (F004) แสดงทุกโต๊ะเรียงตาม id ไม่มีทางหาโต๊ะเร็ว ๆ และไม่รู้ว่าโต๊ะไหนเพิ่งมีการเปลี่ยน ใครเป็นคนแก้ หรือโต๊ะนั้นสร้างเมื่อไร

## สิ่งที่ผู้ใช้จะเห็น

1. ทุกแถวบอก **วันที่สร้าง** และ **วันที่แก้ล่าสุดพร้อมชื่อคนแก้**:
   - `Updated by Jitrudee` แล้วบรรทัดถัดไป `22 Oct, 23:10 · 5 minutes ago` (ชี้ค้างเห็นวันเวลาเต็ม และ ISO ใน `datetime`)
   - `Created 20 Oct, 09:12` (แสดงปีเมื่อเป็นปีอื่น)
   - โต๊ะที่ยังไม่มีคำสั่งเลยมีแค่ `Created …` ไม่มีชื่อคนแก้ เพราะยังไม่มีใครแก้
2. **เรียงอัตโนมัติตามเวลาอัปเดตล่าสุด** ใหม่ → เก่า (ค่าเริ่มต้น) · `Sort` สลับเป็น **Created** เพื่อเรียงตามเวลาสร้างได้ · ตัวเลือกถูกจำใน `localStorage` (`tabletop.tables.sort`) · ปุ่ม Clear filters ไม่รีเซ็ตการเรียง เพราะเป็นการตั้งค่า ไม่ใช่ฟิลเตอร์
3. **Search tables** ข้างหัวข้อ (แสดงเมื่อมีมากกว่า 1 โต๊ะ) ค้นจากชื่อโต๊ะ ชนิดโต๊ะ และ role · ทุกคำต้องเจอ ไม่สนลำดับ · ไม่สนตัวพิมพ์และวรรณยุกต์ละติน แต่คงสระ/วรรณยุกต์ไทย · Esc ล้างช่อง · ไม่เจอแสดง "No tables match …"
4. **Filters** ใต้ช่องค้นหา: Type (เฉพาะชนิดที่มี), Role (Created by me = owner/teacher/dm, Joined), Updated (Today / 7 วัน / 30 วัน) พร้อมจำนวน "x of y" และ Clear
5. "Last opened" ยังเป็นป้ายบนแถว แต่ไม่ดันลำดับอีกต่อไป (ผู้ใช้ขอให้เรียงตามเวลาอัปเดต)

## ข้อเท็จจริงจากโค้ด (2026-10-23)

- "อัปเดต" = เวลาของคำสั่งล่าสุดที่ commit ใน epoch ปัจจุบัน (`MAX(room_events.created_at)`) รวมการย้ายการ์ด (`canvas.layout`) เพราะเป็นตำแหน่งที่ทุกคนเห็นร่วมกัน (F007) · ยังไม่มีคำสั่งเลยใช้ `createdAt`
- "ใครแก้" = `room_events.actor_id` ของคำสั่งล่าสุดนั้น join กับ `room_memberships.actor_name` (ชื่อยังอยู่แม้สมาชิกถูกถอด) · ไม่มีคำสั่ง = ไม่มีชื่อ
- แชท AI ที่ไม่ได้เปลี่ยนโต๊ะไม่นับ (ไม่ได้อยู่ใน `room_events`) · การเปิดโต๊ะหรือ session ใหม่ไม่นับ
- Room ส่ง `x-tabletop-updated-at` และ `x-tabletop-updated-by` (percent-encoded) ของ `/internal/view` · `WorkspaceView` ไม่เปลี่ยน · Worker ใส่ `createdAt`, `updatedAt`, `updatedBy` ใน `SessionView.workspaces`
- Node runtime (`npm start`) ส่งทั้งสามฟิลด์จาก Postgres (`workspaces.created_at`, `events`, `memberships`) แล้ว จึงเห็นผลเหมือนกันในเครื่อง
- ไม่มี migration/schema change: อ่านจากตารางที่มีอยู่แล้ว

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | Room → Worker → `SessionView.{createdAt,updatedAt,updatedBy}` | `cloudflare/room.test.ts` (F053) ผ่าน |
| T2 | Node runtime ส่งฟิลด์เดียวกัน | `server/authority.test.ts` เคส "retain multiple workspaces" ผ่าน |
| T3 | ช่องค้นหา + วันที่ + ชื่อผู้แก้ + สลับการเรียงในหน้า `/tables` | `table-list-filter.test.ts`, `relative-time.test.ts` ผ่าน · ตรวจหน้าจอจริง |
| T4 | เอกสาร + CHANGELOG | ไฟล์นี้ + `CHANGELOG.md` |

## การตัดสินใจ

- **ส่งชื่อผู้แก้ทาง header แบบ percent-encoded** แทนการเพิ่มฟิลด์ใน `WorkspaceView` ที่เป็นสัญญา public: ชื่อผู้ใช้อาจมีอักษรไทย/อักษรอื่นที่ header แบบ latin-1 ไม่รับ และ client ที่มีอยู่ไม่ต้องแก้
- **`updatedAt` = `createdAt` เมื่อยังไม่มีคำสั่ง** เพื่อให้ทุกแถวมีเวลาแก้ล่าสุดเสมอ แต่ `updatedBy` ยังว่าง (ไม่แอบบอกว่าเจ้าของเป็นคนแก้)
- **การเรียงเป็นการตั้งค่า ไม่ใช่ฟิลเตอร์**: Clear filters ไม่แตะ Sort · จำค่าไว้ใน localStorage เฉพาะ browser นี้
- **ไม่นับการเปิดโต๊ะเป็นการอัปเดต**: เวลามาจาก event ที่ commit เท่านั้น เพื่อไม่ให้ลำดับกระโดดจากการเปิดดู
