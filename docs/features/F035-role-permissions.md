# F035 — Role permission ตั้งค่าได้ต่อโต๊ะและต่อคน

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | JitrudeeDongdee (Claude) |
| เวอร์ชันที่คาด | MAJOR — สมาชิกที่เดิมทำได้น้อยจะได้สิทธิ์จัดการโต๊ะตามค่าเริ่มต้นทันทีที่ deploy (rollback โค้ดได้ แต่สิ่งที่สมาชิกทำไปแล้วระหว่างนั้นย้อนไม่ได้) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F035-T*` |

## ทำไม

ผู้ใช้ (2026-10-22): ต้องการกำหนดสิทธิ์ของแต่ละคนในโต๊ะได้เอง มี role ตั้งต้นตาม case ให้เลือก หรือสร้าง role ใหม่เองได้ · ถ้ายังไม่กำหนด ให้สมาชิกมีสิทธิ์เท่าเจ้าของทุกอย่าง **ยกเว้นลบ/รีเซ็ตโต๊ะ** · ใช้กับทุกชนิดโต๊ะตั้งแต่แรก · การมองเห็นข้อมูลไม่อยู่ในระบบนี้ (ทุกคนเห็นทุกอย่างตาม [F034](F034-open-visibility.md))

## สิ่งที่ผู้ใช้จะเห็น

1. หน้าต่าง **People** แสดงทุกคนพร้อม role · คนที่มีสิทธิ์ `roles.manage` เลือก role ให้คนอื่นได้จาก dropdown
2. **Manage roles** แสดง role ตั้งต้นของ case นั้น (แก้ไม่ได้) และ role ที่สร้างเอง (ตั้งชื่อ + ติ๊กสิทธิ์) แก้/ลบได้
3. ปุ่มในโต๊ะซ่อนหรือปิดตามสิทธิ์จริงของคนนั้น · server ปฏิเสธเสมอถ้าไม่มีสิทธิ์ (UI เป็นแค่ความสะดวก)
4. คนที่ยังไม่ถูกกำหนด role แสดงเป็น **"Default (all except delete table)"**

## แค็ตตาล็อกสิทธิ์

ทุกชนิดโต๊ะ:

| สิทธิ์ | คำสั่ง/ช่องทาง |
| --- | --- |
| `table.rename` | `workspace.rename` |
| `members.invite` | สร้างคำเชิญรายที่นั่ง, ลิงก์เชิญใช้ซ้ำ |
| `members.remove` | เอาสมาชิกออก (ไม่รวมเจ้าของ — ไม่มีใครเอาเจ้าของออกได้) |
| `roles.manage` | สร้าง/แก้/ลบ role, กำหนด role ให้คน |
| `rules.draft` | `evolve.propose`, ขอ AI ร่าง (`POST /model`) |
| `rules.approve` | `evolve.simulate/validate/approve/activate/rollback` |

เฉพาะชนิด:

| ชนิด | สิทธิ์ |
| --- | --- |
| `table` | `files.add` (`table.import`), `files.remove` (`table.removeSource`), `data.import` (`table.importRows`), `data.columns` (`table.setComputedColumns`), `table.act` (`table.act` — ยังต้องผ่าน `roles`/turn ของ action ในกฎ), `ai.ask` (`POST /assistant`) |
| `teaching` | `lesson.parameters`, `lesson.representation`, `lesson.note` |
| `encounter` | `game.direct` (declareHit, resolve, endTurn, pause, resume), `game.note` |
| `invoice` | `invoice.review` (reviewSource, sample, saveRun) |

**เจ้าของเท่านั้นเสมอ (ไม่อยู่ในแค็ตตาล็อก):** `workspace.reset` (ลบ/รีเซ็ตโต๊ะ)
**ผูกที่นั่งในเกมเดิม (ไม่อยู่ในแค็ตตาล็อก):** `teaching.answer` (ผู้เรียน), `encounter.shield` (ผู้เล่น) · `canvas.layout` ทุกคน

## Role ตั้งต้นตาม case

| ชนิด | role ตั้งต้น |
| --- | --- |
| `table` | **Manager** (ทุกสิทธิ์) · **Editor** (ไฟล์, ข้อมูล, ร่าง+อนุมัติกฎ, ถาม AI, ทำ action, เปลี่ยนชื่อ) · **Contributor** (เพิ่มไฟล์, ร่างกฎ, ถาม AI, ทำ action) · **Viewer** (ไม่มีสิทธิ์จัดการ) |
| `teaching` | **Co-teacher** (ทุกสิทธิ์) · **Learner** (ไม่มีสิทธิ์จัดการ) |
| `encounter` | **Co-DM** (ทุกสิทธิ์) · **Player** (ไม่มีสิทธิ์จัดการ) |
| `invoice` | **Reviewer** (ทุกสิทธิ์) |

**ค่าเริ่มต้นเมื่อไม่กำหนด:** ทุกสิทธิ์ของชนิดนั้น (เท่า Manager/Co-teacher/Co-DM/Reviewer) · เจ้าของมีทุกสิทธิ์เสมอและเปลี่ยน role ไม่ได้

## กติกากันการยกระดับสิทธิ์

- ต้องมี `roles.manage` ถึงจะแก้ role/กำหนด role ได้
- สร้างหรือกำหนด role ที่มีสิทธิ์**เกินกว่าที่ตัวเองมี**ไม่ได้
- แตะ role ของเจ้าของไม่ได้ · ลบ role ที่มีคนใช้อยู่ไม่ได้ (ต้องย้ายคนก่อน)
- จำกัด role ที่สร้างเอง ≤ 12 ต่อโต๊ะ ชื่อ 1–40 ตัวอักษร

## ที่เก็บ

`DomainState` ทุกชนิดได้ฟิลด์เสริม `access?: { roles: CustomRole[]; assignments: Record<actorId, roleId> }` ใน JSON ของห้องเดิม · role ตั้งต้นเป็นค่าคงที่ในโค้ด (ไม่เก็บ) · ไม่มี SQL migration · โต๊ะเก่าไม่มี `access` = ทุกคนได้ค่าเริ่มต้น · rollback โค้ด: โต๊ะยังเปิดได้ (ฟิลด์ที่ไม่รู้จักถูกละ) แต่ role ที่ตั้งไว้จะไม่มีผลจนกลับมาใช้รุ่นนี้

## ข้อเท็จจริงจากโค้ด (2026-10-22, WIP `753635a` บน `feat/F015-live-chat`)

- ตอนนี้สิทธิ์มาจาก role ตายตัว: `hasRole(...)` ใน `domain/{table,evolution,teaching,encounter}.ts`, `primaryRole`/`ownerActorId` ใน `server/authority.ts`, `requiredModelRole` ใน `cloudflare/room.ts`, `actorAndRole` ใน `cloudflare/ai.ts`
- WIP `753635a` เพิ่ม `PERMISSION_POLICY = 'equal'` + `managesTable` เป็นตัวกลาง — F035 จะแทนด้วย `can(context, permission)` ตัวเดียว

## งาน

ดู `F035-T1`…`T6` ใน [PLAN.md](../../PLAN.md)

## คำถามเปิด

- Viewer ควรแนบไฟล์ได้ไหม (ตอนนี้ไม่ได้)
- ต้องแจ้งเจ้าของไหมเมื่อมีคนเปลี่ยน role ของคนอื่น

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | ใช้กับทุกชนิดโต๊ะตั้งแต่แรก | ผู้ใช้เลือก |
| 2026-10-22 | ค่าเริ่มต้น = ทุกสิทธิ์ยกเว้นลบ/รีเซ็ตโต๊ะ | ผู้ใช้กำหนด |
| 2026-10-22 | ผู้ตั้ง role = เจ้าของ + คนที่มี `roles.manage` · ห้ามให้สิทธิ์เกินตัวเอง | ผู้ใช้เลือกตัวที่แนะนำ |
| 2026-10-22 | การมองเห็นไม่อยู่ในระบบ role | ผู้ใช้เลือก · ใช้ F034 (`VISIBILITY_POLICY = 'open'`) |
| 2026-10-22 | การกระทำในเกมที่ผูกที่นั่ง (ตอบคำถาม, shield) ไม่อยู่ในแค็ตตาล็อก | เป็นกติกาเกม ไม่ใช่สิทธิ์จัดการ ถ้าเปลี่ยนเกมจะเสียความหมาย |
