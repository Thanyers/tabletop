# F046 — เก็บตารางที่ยังใช้ได้เมื่อการ์ด canvas ผิดเชิงความหมาย

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — ไม่มี schema/migration/secret · rollback กลับรุ่นก่อนได้ทันที (รุ่นเก่ากลับไปปฏิเสธร่างที่มี view ผิดเหมือนเดิม) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F046-T1` |

## ทำอะไร

`parseTableChangeSalvagingCanvas` (F023) เคยช่วยได้เฉพาะ view ที่ **ผิด schema** เช่น field แปลกปลอมหรือ primitive ไม่ครบ ถ้า view ผ่าน schema แต่ **ผิดเชิงความหมาย** — scene text ที่คืนตัวเลข, metric ที่ไม่ใช่ scalar, `relatedTo` ชี้ view ที่ไม่มี, ตัวแปร shadow — ทั้งร่างจะถูกปฏิเสธทั้งก้อน ทั้งที่ตัวตาราง (collection/field/action) ถูกต้อง

F046 ทำให้การกู้ร่างทำงานสองชั้น:

1. **schema** เหมือนเดิม (F023)
2. **semantic** ใหม่: ตัดเฉพาะ view ที่ไม่ผ่าน `validateGenerativeProgram` / `validateGenerativeOutput` แล้วคืนส่วนที่เหลือ

view ถูกตรวจ **เป็นชุด** เพราะ `relatedTo` เชื่อม view ด้วยกัน การตรวจทีละใบจะทิ้ง view ที่ถูกทุกใบ (วัดได้: ชุด 6 view ที่ production รับแล้ว เหลือ 0 ใบเมื่อตรวจเดี่ยว) และเมื่อตัด view หนึ่งทิ้ง ระบบจะลบลิงก์ที่ชี้มาที่มันให้ด้วย (`dropRuleItemLinks`) เพื่อไม่ให้ view เพื่อนบ้านพังตาม

ถ้า **ตัว program แกนกลาง** ผิด (ไม่ใช่ view) ฟังก์ชันจะคืนร่างเดิมไม่แตะ เพื่อให้ผู้เรียก ([`cloudflare/ai.ts`](../../cloudflare/ai.ts) และตัวตรวจของ harness) รายงานสาเหตุจริง ไม่ใช่กลบด้วยการตัด view

## สิ่งที่ผู้ใช้จะเห็น

1. คำขอที่คำตอบมี view ผิด 1 ใบ → ได้ตารางพร้อมการ์ดที่เหลือ แทน "The generated tool did not pass validation. Nothing was activated."
2. ถ้าทุก view ผิด → ได้ตารางเปล่าไม่มี view (ยังใช้งานตารางได้) แทนไม่ได้อะไรเลย
3. ถ้าตัว program ผิดเอง → ข้อความปฏิเสธเดิมพร้อมเหตุผลจริง (ไม่เปลี่ยน)

ไม่ได้เปลี่ยนจำนวนครั้งที่เรียกโมเดล ไม่ได้เปลี่ยนสัญญา JSON ที่สำเร็จ และไม่ได้ซ่อนข้อผิดพลาดของ program

## ขอบเขต

**รวม:** การกู้ร่างในเส้นทาง provider (`parseTableChangeSalvagingCanvas`) · การลบลิงก์เมื่อตัด view · test ของชุด view/ลิงก์/แกนกลางพัง

**ไม่รวม:** การกู้ในเส้นทาง manual (`parseBoundedTableChange` — ยังคงเดิม ผู้ใช้กดวางเองควรเห็น error) · การบอกโมเดลว่า view ถูกตัด (รอบซ่อมยังเห็น issue เดิม) · การเปลี่ยน `removeTableRuleItem` ของ F039 (แค่ย้ายบล็อกลบลิงก์มาใช้ร่วม)

## ข้อเท็จจริงจากโค้ด (2026-10-22, branch `feat/F046-view-salvage` จาก `origin/dev` @ `35a9820`)

- [`src/tabletop/domain/table.ts`](../../src/tabletop/domain/table.ts) — `parseTableChangeSalvagingCanvas` / `canvasSalvagedChange` (F023) → เพิ่ม `salvageInvalidViews`, `withoutView`, `dropRuleItemLinks`, `viewIssues`, `viewOutputIssues`, `salvageViewSet`
- `validateGenerativeProgram` (validation.ts) จับ scene text/type/shadow/unknown view/unknown collection/metric scalar; `validateGenerativeOutput` (table.ts) รัน evaluator บน probe contexts
- `removeTableRuleItem` (F039) มีบล็อกลบลิงก์อยู่แล้ว → ย้ายมาเป็น `dropRuleItemLinks` ใช้ร่วมกัน ไม่เปลี่ยนพฤติกรรม
- ผู้เรียกเดียว: [`server/providers/deepseek-changes.ts:318`](../../server/providers/deepseek-changes.ts) (เส้นทางร่างกฎ)

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | semantic salvage + link cleanup + test | `table-canvas-salvage.test.ts` 12 ผ่าน (6 ใหม่) · `table.test.ts` 15 · `table-preserve.test.ts` 3 · typecheck ผ่าน |

## คำถามเปิด

- ควรบอกโมเดลในรอบซ่อมหรือไม่ว่า "ระบบตัด view X ออกเพราะ …" เพื่อให้รอบถัดไปไม่สร้างซ้ำ — ต้องแก้ provider (ไฟล์ที่ F045 ถืออยู่) จึงเลื่อนไปทำหลัง merge
- ควรนับ "จำนวน view ที่ถูกตัด" ลง job เพื่อให้การ์ดบอกผู้ใช้ไหม — เป็นงาน UI ต่างหาก

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | ตรวจ view เป็นชุด ไม่ใช่ทีละใบ | `relatedTo` เชื่อม view; ตรวจเดี่ยวทำให้ view ที่ถูกถูกทิ้ง (วัดจาก draft จริง: 0/5–6 ใบรอด) |
| 2026-10-22 | ใช้ `validateGenerativeProgram` ทุกครั้ง แต่รัน evaluator (`validateGenerativeOutput`) เฉพาะตอนจบ/ทางตัน | กันเวลาตรวจบวมเป็น O(n²) บน evaluator ที่รัน probe contexts |
| 2026-10-22 | แกนกลางพัง = ไม่กู้ | การตัด view ไม่ช่วย และจะกลบสาเหตุจริงที่ต้องรายงาน |
