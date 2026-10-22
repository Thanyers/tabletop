# F047 — ลดการปฏิเสธร่างที่เกิดจาก "การเขียนชื่อ" ไม่ใช่ "การออกแบบ"

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — ไม่มี schema/migration/secret · rollback กลับรุ่นก่อนได้ทันที (พฤติกรรมกลับไปปฏิเสธ/route แบบเดิม) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F047-T*` |

## ทำไม

หลัง F031 (compact guide + thinking) ร่างที่ยังตกหล่นไม่ได้ตกเพราะ "โมเดลคิดไม่ออก" เป็นส่วนใหญ่ แต่ตกเพราะรายละเอียดที่ระบบตัดสินได้เอง:

| อาการที่วัดได้ | หลักฐาน |
| --- | --- |
| id ที่โมเดลตั้ง (`totalProfit`, `Sales 2026`) ผิด `/^[a-z][a-z0-9_-]{0,39}$/` → reject ทั้งร่าง | `schema-other` = **23/30 (76.7%)** ของ issue ที่เหลือใน live run 2026-10-21 (2 trials × 21 เคส) |
| validator บังคับ `manifestNodes <= 24`, expression depth 32 / nodes 512 แต่ prompt ไม่เคยบอก | `src/tabletop/runtime/generative/validation.ts` vs `server/providers/table-schema-guide.ts` |
| คำขอที่ไม่มีคำว่า "สร้าง/เพิ่ม" ถูกส่งไปถาม AI แทนการสร้าง | `src/tabletop/ui/table-chat-state.ts` (binary regex) |

ผลคือผู้ใช้เห็น "ตารางถูกปฏิเสธ" หรือ "พิมพ์ขอแล้วเงียบ" ทั้งที่งานส่วนใหญ่ทำได้

## สิ่งที่ผู้ใช้จะเห็น

1. ร่างที่ตั้งชื่อเป็น camelCase/มีช่องว่าง → **ได้ตาราง** (ระบบแปลงชื่อให้และแก้ reference ให้ครบ) แทนข้อความปฏิเสธ
2. คำขอที่กำกวมและยังไม่มีตาราง → ไปทาง "สร้าง" ไม่ใช่ทาง "ตอบคำถาม" (สร้างผิดเห็นเป็นร่างให้ตรวจ ดีกว่าพิมพ์แล้วไม่มีอะไรเกิดขึ้น)
3. คำถามจริงยังตอบเป็นคำถาม · การแก้ข้อมูลแถวเดียว ("ทำเครื่องหมายว่าจ่ายแล้ว") ยังเป็นการ์ดคำตอบ ไม่ถูกผลักไปเป็นร่างกฎ

## ขอบเขต

**รวม:** id normalization ในเส้นทาง AI draft · guide ที่ดึงตัวเลขจากค่าคงที่เดียวกับ validator + drift test · classifier 4 intent ใช้ร่วม (`build` / `edit` / `ask` / `act`)

**ไม่รวม:** เปลี่ยนน้ำหนัก/โมเดล · auto-apply (F039) · เปลี่ยนสัญญา JSON · เส้นทาง manual paste (ยังเห็น error ตามเดิม) · การบอกโมเดลว่า id ถูกแปลง (รอบซ่อมยังเห็น issue เดิม)

## ข้อเท็จจริงจากโค้ด (2026-10-22, branch `feat/F047-generation-reliability` จาก `origin/dev` @ `6576b15`)

- [`src/tabletop/domain/id-normalization.ts`](../../src/tabletop/domain/id-normalization.ts) (ใหม่) — `normalizeGeneratedTableChange` แปลง id ที่ผิด + เขียน reference ใหม่ทั้ง actions/expressions/views/records; ถ้า id สองตัวยุบเป็นชื่อเดียวจะยกเลิกทั้งก้อน (ไม่รวมของสองอย่างเงียบ ๆ)
- [`server/providers/deepseek-changes.ts`](../../server/providers/deepseek-changes.ts) — เรียก normalizer หลัง parse JSON ก่อน schema (จุดเดียว, ไม่เปลี่ยน flow)
- [`src/tabletop/domain/table.ts`](../../src/tabletop/domain/table.ts) — `TABLE_LIMITS` เป็นแหล่งความจริงเดียว และ zod schema ใช้ค่าจากมัน
- [`server/providers/table-schema-guide.ts`](../../server/providers/table-schema-guide.ts) — LIMITS line ประกอบจาก `TABLE_LIMITS` + `GENERATIVE_LIMITS`; มี test กัน drift
- [`src/tabletop/shared/chat-intent.ts`](../../src/tabletop/shared/chat-intent.ts) (ใหม่) — `classifyChatIntent` 4 intent; [`src/tabletop/ui/table-chat-state.ts`](../../src/tabletop/ui/table-chat-state.ts) เรียกตัวนี้แทน regex เดิม (ยังคงกฎ "ข้อความเกี่ยวกับการ์ดที่อ้างถึง = แก้การ์ดนั้น")

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | id normalization + reference rewrite | `id-normalization.test.ts` 7 ผ่าน · draft camelCase ที่เคยตกผ่าน `tableChangeSchema` และ `applyTableChange` |
| T2 | `TABLE_LIMITS` + guide ที่ interpolate + drift test | `table-schema-guide.test.ts` 4 ผ่าน · guide มีทุกตัวเลขที่ validator บังคับ |
| T3 | chat intent classifier 4 แบบ | `chat-intent.test.ts` 8 + `table-build-intent.test.ts` 8 + `table-chat-state.test.ts` 11 ผ่าน |

## คำถามเปิด

- intent ที่กำกวมควรไปทาง "สร้าง" เสมอไหมเมื่อมีตารางอยู่แล้ว — ตอนนี้ไปทาง `edit`; ถ้าเจอ draft ที่ไม่ต้องการบ่อยใน production ต้องมีปุ่ม "ยกเลิก/ถามแทน"
- ควรบอกโมเดลในรอบซ่อมว่า id ถูกแปลงหรือไม่ — ไม่จำเป็นถ้าผ่าน แต่ช่วยให้รอบถัดไปตั้งชื่อถูก

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | แปลง id ที่ host ไม่ใช่สั่งโมเดลใหม่ | เป็นงาน deterministic ที่ทำได้ฟรี และ retry แพงกว่า |
| 2026-10-22 | ยุบชื่อชนกัน = ยกเลิกทั้งก้อน | รวมสอง field เงียบ ๆ อันตรายกว่าการปฏิเสธ |
| 2026-10-22 | ค่า limit มาจาก `TABLE_LIMITS`/`GENERATIVE_LIMITS` ไม่ใช่ข้อความมือ | `manifestNodes` เคยเป็น drift ที่ทำให้ reject โดยไม่มีใครรู้ |
| 2026-10-22 | กำกวม = ไปทางสร้าง/แก้ | คำถามไม่สร้างอะไร แต่ร่างที่เกินมาคนกดยกเลิกได้ |
