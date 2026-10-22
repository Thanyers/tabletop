# F039 — กฎจาก AI เปิดใช้อัตโนมัติ + ลบกฎทีละรายการ

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | JitrudeeDongdee (Claude) |
| เวอร์ชันที่คาด | MINOR (ไม่มี migration; rollback แล้วรุ่นเก่ายังอ่าน state ได้ และร่างที่ค้างอยู่กลับไปใช้ขั้นตอนตรวจแบบเดิม) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F039-T*` |

## ทำไม

ตอนนี้ร่างกฎจาก AI ขึ้นการ์ด "A rule draft is ready. Review it before anyone uses it." และต้องกด Review rules → Preview → Check → Approve → Use ทีละขั้น ผู้ใช้อยากให้กฎใหม่ถูกเพิ่มเองทันที ถ้าไม่ต้องการกฎไหนค่อยเอาออกทีหลัง

## สิ่งที่ผู้ใช้จะเห็น

1. ส่งคำขอร่างกฎในแชท → AI ร่าง → **กฎถูกเพิ่มเข้าโต๊ะเอง** การ์ดขึ้นว่าเพิ่มกฎแล้ว (rule revision ใหม่)
2. ถ้าร่างไม่ผ่านการตรวจ เช่น ข้อมูลเดิมผิดข้อบังคับใหม่ การ์ดบอกเหตุผล แล้วยังให้ตรวจเองได้ด้วยปุ่ม Review rules แบบเดิม
3. การ์ด Rules มีรายการกฎ: action, ข้อบังคับ (invariant), view และตาราง (collection) แต่ละรายการมีปุ่มเอาออก
   - การเอาออกสร้าง rule revision ใหม่ จึงย้อนจากประวัติกฎได้
   - การเอาตาราง (collection) ออก จะลบข้อมูลในตารางนั้นด้วย ต้องยืนยันก่อน
   - รายการที่มีสิ่งอื่นอ้างถึง เช่น action ที่ใช้ตารางนั้น จะบอกว่าต้องเอาตัวที่อ้างถึงออกก่อน

## ขอบเขต

**รวม:** ร่างกฎจาก AI ทุกชนิดโต๊ะ (table / teaching / encounter / invoice; เดิมตั้งใจแค่ `table` ผู้ใช้ขยายเมื่อ 2026-10-22) · โต๊ะเกมที่พักอยู่ไม่เปิดใช้เอง · การเอากฎออกทีละรายการยังเฉพาะ `table` · ทุกคนที่มีสิทธิ์ `rules.draft` ทั้งร่างและให้เปิดใช้อัตโนมัติได้ · การเอากฎออกใช้สิทธิ์ `rules.draft`
**ไม่รวม:** ข้อเสนอที่คนกดเองในโต๊ะห้องเรียน/เกม/ใบแจ้งหนี้ (ไม่ใช่ AI) ยังใช้ขั้นตอนตรวจแบบเดิม · action proposal จาก AI assistant ยังต้องให้คนถามกดยืนยันเหมือนเดิม · การแก้กฎทีละรายการ (แก้ = ขอ AI ร่างใหม่)

## ข้อเท็จจริงจากโค้ด (2026-10-22)

- `src/tabletop/domain/evolution.ts` — `handleEvolutionCommand`: `evolve.propose` (`rules.draft`) → `evolve.simulate` → `evolve.validate` → `evolve.approve` → `evolve.activate` (สี่ขั้นหลังใช้ `rules.approve`) · `nextStateWithChange` เปิดใช้ candidate เป็น rule revision ใหม่ · `evolve.rollback` สร้าง candidate จาก revision เก่า
- `server/authority.ts` — `verifyActivationApproval` ตรวจ approval ที่บันทึกในตาราง approvals และผู้อนุมัติต้องมี `rules.approve`
- `cloudflare/room.ts` (~1320) — งาน `/model` สร้าง envelope `evolve.propose` แล้ว commit ในนามคนขอ
- `src/tabletop/shared/table-contracts.ts` — `TableProgram` = `collections`, `actions`, `invariants`, `canvas.views`, `turnOrder` · กฎหนึ่งชุดแทนที่โปรแกรมทั้งก้อน
- `src/tabletop/ui/WorkbenchShared.tsx` `CandidateLifecycle` — ปุ่ม Preview / Check / Approve / Use

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | domain + authority: คำสั่ง `evolve.autoApply` (โต๊ะ `table`, candidate ของคนสั่งที่ยังเป็น draft, สิทธิ์ `rules.draft`) รัน simulate → validate ถ้าผ่านครบ approve + activate ในคำสั่งเดียว (บันทึก approval แบบเดียวกับขั้น approve) · ไม่ผ่าน = เก็บผลตรวจไว้ใน candidate ให้ตรวจเองต่อ | unit: ผ่าน → rule revision +1 และมี approval · ไม่ผ่าน → ไม่เปลี่ยนกฎและเห็นเหตุผล · คนไม่มี `rules.draft` ถูกปฏิเสธ · candidate ของคนอื่นถูกปฏิเสธ |
| T2 | Room: หลังงาน `/model` สร้าง candidate แล้วสั่ง `evolve.autoApply` ในนามคนขอ · ผลงานบอก `applied` หรือ `needs-review` พร้อมเหตุผล | room test: งานจบแล้วกฎเปิดใช้ · ร่างที่ไม่ผ่านค้างเป็น needs-review |
| T3 | domain: `table.removeRuleItem { kind: action/invariant/view/collection, id }` สร้างโปรแกรมใหม่ที่ไม่มีรายการนั้น แล้วเปิดใช้เป็น revision ใหม่ · มีตัวอ้างถึงอยู่ = ปฏิเสธพร้อมรายชื่อ · collection ลบข้อมูลด้วย | unit: ลบแต่ละชนิด, ถูกอ้างถึงแล้วปฏิเสธ, revision +1, rollback กลับได้ |
| T4 | UI: การ์ดร่างแสดง "เพิ่มกฎแล้ว" หรือ "ต้องตรวจเอง" + เหตุผล · การ์ด Rules มีรายการพร้อมปุ่มเอาออก + ยืนยันตอนลบตาราง | ใช้งานจริงบน emulator สองบัญชี |
| T5 | เทสต์ (subagent) + คู่มือ + CHANGELOG + แก้ CLAUDE.md เรื่อง human confirmation | ชุดเต็มตอน release |

## คำถามเปิด

- ถ้าร่างถูกเปิดใช้เองแล้วมีสมาชิกทำ action ค้างอยู่ (เช่น proposal ของ assistant) ให้ proposal นั้นเป็น stale ตามเดิม (กลไกปัจจุบัน)

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | เปิดใช้อัตโนมัติโดยรันขั้นตรวจทั้งหมดให้เอง ไม่ข้ามการตรวจ | ผู้ใช้เลือก · กันข้อมูลเดิมผิดข้อบังคับใหม่ |
| 2026-10-22 | ทุกคนที่มี `rules.draft` ได้เปิดใช้อัตโนมัติ | ผู้ใช้เลือก · `rules.approve` ยังใช้กับขั้นตอนตรวจเองแบบเดิม |
| 2026-10-22 | เอากฎออกทีละรายการ (ไม่ใช่ undo ทั้งชุด) | ผู้ใช้เลือก · ยังย้อนทั้งชุดได้จากประวัติ revision |
| 2026-10-22 | ใช้ F039 เพราะ F038 เป็นของ #131 | #131 แตะ `room.ts`/`useTableChat.tsx` เหมือนกัน T2/T4 จึงทำหลัง #131 merge |
