# F015 — สมาชิกเห็นทุกอย่างในโต๊ะ (เก็บสวิตช์ไว้กลับไปแบบส่วนตัวได้)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | JitrudeeDongdee (Claude) |
| เวอร์ชันที่คาด | **MAJOR** — โค้ด rollback ได้ แต่ข้อมูลที่เคยซ่อนจะถูกเห็นทันทีที่ deploy และ "เห็นไปแล้ว" ย้อนไม่ได้ ([AGENTS.md §5](../../AGENTS.md#5-ออก-release)) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F015` |

## ทำไม

ผู้ใช้ (เจ้าของงาน) ตัดสินใจ 2026-10-21: ตอนนี้ปล่อยให้สมาชิกเห็นทุกอย่างไปก่อน แต่ **เก็บช่องทางจัดการสิทธิ์ไว้** เผื่อกลับมาทำเพิ่มทีหลัง

## สิ่งที่ผู้ใช้จะเห็น

- สมาชิกทุก role เห็นสถานะโต๊ะครบ: ร่างกฎและประวัติร่างของเจ้าของ, หลักฐานอ้างอิง, โน้ต DM/ครู, ค่าทอยที่ยังไม่เปิด, คำตอบ/การตั้งค่าของผู้เรียนคนอื่น, ตัวละครที่ซ่อน
- ประวัติแชท AI ในโต๊ะเป็นของทุกคน: การ์ดของคนอื่นมีบรรทัด "Asked by <ชื่อ>" · action ที่ AI เสนอให้คนอื่น ขึ้นว่า "Only <ชื่อ> can confirm this proposal." ปุ่ม Prepare changes ของคำขอคนอื่นไม่แสดง
- หน้าขอความยินยอมบอกว่า "Everyone at this table can see your questions, the answers and rule drafts." · คำว่า private chat / private conversation เปลี่ยนเป็น recent chat / table conversation
- คนที่ไม่ใช่สมาชิก **ยังอ่านไม่ได้** เหมือนเดิม

## ขอบเขต

**รวม:** การอ่านทุกช่องทาง (GET, ผลหลัง command, WebSocket, reset) ผ่าน `projectDomain` · ประวัติแชท (`GET /assistant`) และสถานะงาน (`GET /assistant/<job>`) ของทุกสมาชิก
**ไม่รวม (คงเดิม):** การยืนยัน action ของ AI (เฉพาะคนถาม), งานร่างกฎ (`/model`, เฉพาะเจ้าของ), บริบทที่ส่งให้ AI (เฉพาะแชทของคนถามเอง ≤6 คู่), การตรวจ membership/role/turn ตอนสั่ง command

## ข้อเท็จจริงจากโค้ด (2026-10-21)

- `src/tabletop/shared/visibility.ts` — `VISIBILITY_POLICY: 'open' | 'private'` จุดเดียว
- `src/tabletop/domain/projections.ts` — `projectDomain(state, ctx, policy)` = `assertCanRead` (ด่าน membership/role เดิม) → `'open'` คืน clone ทั้งก้อน · `'private'` = `projectPrivate` (โค้ดเดิมทั้งหมด)
- `cloudflare/room-repository.ts` — `listTableAssistantJobs({ scope: 'table' | 'actor' })`, `getTableModelJob` (อ่านงานของสมาชิกคนใดก็ได้ในโต๊ะ/epoch)
- `cloudflare/room.ts` — history และ poll ใช้ scope ตาม policy · ทุก job view มี `askedBy` · confirm ยังใช้ `getModelJob(…, actorId)`
- `src/tabletop/ui/useTableChat.tsx`, `TableChat.tsx`, `table-chat-consent.ts` — ป้ายผู้ถาม, ซ่อนการกระทำของคนอื่น, ข้อความตาม policy

## วิธีกลับไปแบบส่วนตัว

แก้ `VISIBILITY_POLICY = 'private'` ใน `visibility.ts` แล้ว deploy · ทุกจุดอ่าน policy จากค่านี้ · เทสต์ต้องครอบทั้งสองค่า

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F015 | policy switch + open + UI/copy + เอกสาร + เทสต์ทั้งสอง policy | unit: projectDomain ทั้ง open/private ทุกชนิดโต๊ะ + คนนอกยังถูกปฏิเสธ · room: history/poll ของคนอื่นอ่านได้ใต้ open, confirm ของคนอื่นถูกปฏิเสธ · browser: เทสต์ privacy เดิมเปลี่ยนเป็นตรวจว่าเห็น, การ์ดแชทคนอื่นมี "Asked by" และไม่มีปุ่ม Confirm |

## คำถามเปิด

- จะประกาศให้ผู้ใช้จริงบน staging/production รู้ก่อน deploy ไหม (ข้อมูลที่เคยเชื่อว่าเป็นความลับจะถูกเห็นย้อนหลัง)
- อนาคตจะทำสิทธิ์แบบละเอียด (ต่อ field / ต่อ role) บน `'private'` หรือออกแบบใหม่

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | เปิดให้สมาชิกเห็นทุกอย่าง รวมแชท AI ของทุกคน ทุกชนิดโต๊ะ | ผู้ใช้เลือกหลังรับทราบผลกระทบ (ข้อมูลเดิมถูกเห็นย้อนหลัง, เกม encounter เห็นค่าทอย, ขัดกฎเดิมใน CLAUDE.md) |
| 2026-10-21 | ทำเป็นสวิตช์จุดเดียว ไม่ลบโค้ด private | ผู้ใช้ต้องการเก็บช่องทางจัดการไว้ทำเพิ่มทีหลัง |
| 2026-10-21 | การยืนยัน action / บริบท AI / membership คงเดิม | เป็นเรื่องการกระทำและความถูกต้อง ไม่ใช่การมองเห็น |
