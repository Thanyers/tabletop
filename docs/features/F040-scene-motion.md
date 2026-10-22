# F040 — การเคลื่อนที่แบบวนลูปใน scene ที่ AI สร้าง

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เพิ่มความสามารถใน canvas descriptor (ไม่มี migration/secret/binding) · rollback กลับรุ่นก่อนได้ (รุ่นเก่าไม่รู้จัก `motion` จึงไม่วาดภาพเคลื่อนไหว แต่ยังเปิดโต๊ะได้) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F040-T*` |

## ทำไม

ผู้ใช้สั่ง AI ว่า "รถต้องขยับไปเรื่อย ๆ ไม่ใช่ 10 เมตร เป็นการขยับ จาก 0 ไปสุดระยะทางแล้ว reset กลับมาเรื่อย ๆ แบบวนลูปอัตโนมัติ และปรับความเร็วตาม parameter" แต่ canvas ที่ระบบสร้างได้มีแต่ภาพนิ่งกับ interaction (ลาก/สไลเดอร์) ไม่มีความหมายของ "เวลา" เลย — โมเดลจึงทำได้แค่ของที่ขยับเมื่อมีคนกด/ลาก ไม่มีทางสร้างรถที่วิ่งวนเองได้

## สิ่งที่ผู้ใช้จะเห็น

1. โต๊ะที่มี scene ซึ่งธาตุหนึ่งระบุ `motion` จะมีรถ/วัตถุวิ่งจากจุดเริ่มไปจุดสิ้นสุดแล้ววนกลับมาเริ่มใหม่ทันที (loop) โดยไม่ต้องกดอะไร
2. ความเร็วมาจาก parameter ของโต๊ะ: สไลเดอร์ "ความเร็ว" เขียนค่าลง record แล้ว scene อ่านค่านั้นมาใช้ — เลื่อนสไลเดอร์แล้วรถเร็วขึ้น/ช้าลง
3. ปุ่ม **หยุดการเคลื่อนไหว / เล่นต่อ** ใต้ scene (WCAG 2.2.2) และถ้าผู้ใช้ตั้ง `prefers-reduced-motion: reduce` ระบบจะไม่เล่นอนิเมชันเลย (แสดงที่จุดเริ่มต้น)
4. ภาพยังเป็นข้อมูลของโต๊ะ: ทุกคนเห็นรถตำแหน่งต่างกันได้ตามเวลาที่โหลด แต่กติกา/record ไม่เปลี่ยนจากการเคลื่อนไหว (ไม่มี server write, ไม่มี clock ใน state)

## ขอบเขต

**รวม:** `motion` ของ primitive ชนิด `rect`, `circle`, `text` (แกน x หรือ y) · ค่า `from`, `to`, `speed` เป็น number หรือ expression แบบเดียวกับ geometry · `loop` (default true) · ตรวจ schema/validation/evaluator · prompt guide ให้ AI รู้จัก · ปุ่มหยุดชั่วคราว + reduced motion · unit/browser test

**ไม่รวม:** group/transform, easing, keyframe หลายช่วง, การซิงก์เวลาระหว่างสมาชิก, การเก็บสถานะ "กำลังเล่น" ลงโต๊ะ, animation บน `line`/`polygon`

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-22)

- `src/tabletop/shared/generative-contracts.ts` — `ScenePrimitive` เป็น discriminated union ของ rect/circle/line/polygon/text; ค่าพิกัดเป็น `SceneValue = number | GenerativeExpression`
- `src/tabletop/runtime/generative/schema.ts` — zod เป็น authoritative; `scenePrimitiveSchema` ใช้ `strictObject` ทุกชนิด
- `src/tabletop/runtime/generative/evaluator.ts` — `scenePrimitive()` แปลงค่าเป็น number แล้วส่งให้ UI
- `src/tabletop/runtime/generative/validation.ts` — วน key ของ element ผ่าน `validateSceneValue`; ถ้าเพิ่ม object ใหม่ต้องแยกตรวจ ไม่งั้นจะถูกมองว่าเป็น expression
- `src/tabletop/ui/GeneratedCanvasObjects.tsx` — `SceneView` วาด SVG นิ่ง; ไม่มี rAF/clock มาก่อน
- `server/providers/table-schema-guide.ts` — prompt บอกว่า "no network, wall clock or randomness" จึงต้องแก้ข้อความให้ motion เป็นข้อยกเว้นที่ควบคุมได้

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | contract + zod + evaluator + validation | `npm test -- generative` ผ่าน: schema รับ/ปฏิเสธ motion, evaluator คืนค่า from/to/speed, validation จับ motion บน line/polygon หรือคู่กับ drag |
| T2 | UI: clock, interpolate, ปุ่มหยุด, reduced motion | browser/unit test เห็นตำแหน่งเปลี่ยนตามเวลาและหยุดเมื่อปิด |
| T3 | prompt guide + ตัวอย่างรถ 10 เมตร | live/corpus case ที่ขอ "รถวิ่งวน 10 เมตร ปรับความเร็วได้" ออกมาเป็น draft ที่มี motion |

## ผลตรวจ

- `npx vitest run src/tabletop/runtime/generative/motion.test.ts src/tabletop/ui/scene-motion.test.ts` — **8/8**
  (schema/evaluator/validation, ตำแหน่งวนลูป, ทิศย้อนกลับ, หยุดที่ `to`, ไม่แก้ projection เดิม)
- `npm test` — **520 passed / 1 skipped** (Node 22.23.2); `npm run test:cloudflare` — **113/113**
- `npm run typecheck` และ `npm run build` ผ่าน
- prompt guide/คำสั่งเสียบ MOTION และตัวอย่างรถ 10 เมตรแล้ว — ยังไม่ได้รัน live corpus ยืนยันว่าโมเดลใช้ motion จริง (ต้องมี release บน staging ก่อน)
- `npm run lint` รันในเครื่องไม่ได้ (ไม่มี `eslint` binary) — CI เป็นผู้รัน

## คำถามเปิด

- live corpus ยังไม่ยืนยันว่าโมเดลเลือกใช้ `motion` แทน step action เมื่อผู้ใช้ขอ "รถวิ่งวน"
- ตำแหน่งเริ่มต้นของแต่ละ client ต่างกัน (เริ่มที่ `from` ตอน mount) — ยอมรับสำหรับ POC; ถ้าต้องการทุกคนเห็นเฟสเดียวกันต้องใส่ epoch time ภายหลัง

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | `motion` อยู่บน primitive ไม่ใช่ view | ต้องการให้รถ (หลายชิ้น) เคลื่อนที่พร้อมกันด้วยค่าเดียวกันได้ และไม่ผูกกับ view ทั้งใบ |
| 2026-10-22 | `speed` เป็น scene units ต่อวินาที | เป็นหน่วยเดียวกับพิกัด SVG ทำให้ไม่ต้องมีแนวคิด "เมตร" ในโค้ด; โมเดลคูณ scale เองผ่าน expression |
| 2026-10-22 | เริ่มที่ `from` เมื่อ mount และวนที่ `to` | ตรงกับคำขอ "จาก 0 ไปสุดระยะทางแล้ว reset"; ไม่ต้องเก็บเวลาใน state |
| 2026-10-22 | ไม่รองรับ line/polygon/drag | ลดความซับซ้อนของ hit-test/การลาก; รถสร้างจาก rect/circle ได้ |
| 2026-10-22 | มีปุ่มหยุดและเคารพ reduced motion | อนิเมชันอัตโนมัติเกิน 5 วินาทีต้องหยุดได้ (WCAG 2.2.2) |
