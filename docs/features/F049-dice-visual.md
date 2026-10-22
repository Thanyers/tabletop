# F049 — ลูกเต๋าบนการ์ด controls (v1, สุ่มฝั่ง client)

| | |
| --- | --- |
| สถานะ | `review` (v1 เสร็จในเครื่อง ยังไม่ push/merge) |
| เจ้าของฟีเจอร์ | lead (AI) — งานนี้ทำโดย subagent `dice-visual` |
| เวอร์ชันที่คาด | MINOR (additive: union member ใหม่ + schema member ใหม่ ไม่มี migration/secret/binding) · rollback กลับรุ่นก่อนได้ แต่โต๊ะที่บันทึก `kind:"dice"` ไว้จะไม่แสดงการ์ด controls นั้นในรุ่นเก่า เพราะ schema เป็น `strictObject` |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F049` |

## ทำไม

โต๊ะเกมที่ AI สร้างมีปุ่ม/ฟอร์ม/สไลเดอร์ แต่ไม่มีทาง "ทอยลูกเต๋า" ที่เป็นภาพและให้ผลลัพธ์จริง ผู้เล่นจึงต้องพิมพ์ตัวเลขเองหรือใช้สไลเดอร์ ซึ่งไม่ตรงกับคำขอแบบ "ทอย 2d6+1 แล้วเอาค่าไปหักเลือด" และการ์ดฟอร์มที่ bind parameter เดียวกันก็ไม่เห็นค่าที่ทอยบนอีกการ์ด

## สิ่งที่ผู้ใช้จะเห็น

1. โต๊ะที่มี view `kind:"controls"` ซึ่งมี control `kind:"dice"` จะมีการ์ด controls ของตัวเอง แสดง stepper **จำนวนลูกเต๋า** (1–10) และ **หน้า/ลูก** (2–100) พร้อมสูตร เช่น `2d6 + 1`
2. ปุ่ม **ทอย** ใต้การ์ด — กดแล้วได้หน้าลูกเต๋าทีละลูก (จุดแบบ d6, หน้าลูกเต๋า 7 ขึ้นไปแสดงตัวเลข) เรียงเป็นแถว แล้วมีผลรวมและส่วนประกอบ (ผลรวมก่อน modifier, modifier)
3. หน้าลูกเต๋ามีท่าทอยสั้น ๆ (~0.4 วินาที) ด้วย CSS · ถ้าผู้ใช้ตั้ง `prefers-reduced-motion: reduce` ผลลัพธ์จะขึ้นทันทีโดยไม่มีการเคลื่อนไหว (ทั้งการ์ดไม่ใส่คลาสอนิเมชัน และ CSS ปิดอนิเมชันซ้ำอีกชั้น)
4. ค่าที่ทอยได้ถูกเขียนลง **shared client draft store** (คีย์ `(workspaceId, actionId, parameterId)`) การ์ดอื่น—เช่นฟอร์มหรือปุ่มบนอีก view—ที่ bind parameter เดียวกันจะเห็นค่านั้นทันที และกดส่ง action ได้ (ค่าที่เห็นคือค่าที่จะส่ง)
5. ถ้าค่าที่ทอยได้อยู่นอกช่วง `min/max` ของ parameter การ์ดจะบอกตรง ๆ ว่า total อยู่นอกช่วง และชี้ให้ไปแก้ที่การ์ดที่ส่ง action แทนการ clamp เงียบ ๆ
6. AI drafter รู้จัก `kind:"dice"` แล้ว — prompt guide (`server/providers/table-schema-guide.ts`) มี CONTROL ของ dice, บล็อก `DICE:` และตัวอย่าง controls view หนึ่งใบ (พร้อมฟอร์มบนอีก view ที่ปิด input ของ action เดียวกัน) · **การสุ่มยังเป็นฝั่ง client และ visual-only เหมือนเดิม** AI เพียงเขียน descriptor ไม่ได้ทำให้ server ทอย

## ขอบเขต

**รวม (v1):** control `kind:"dice"` `{ id, kind, label, parameter, faces, count, modifier? }` · validation (faces 2–100, count 1–10, modifier เป็นจำนวนเต็ม |modifier| ≤ 1000, parameter ต้องมีอยู่จริงและ type `number`) · zod schema · stepper + ปุ่มทอย + หน้าลูกเต๋า/ผลรวม + reduced motion · shared draft store ฝั่ง client · prompt guide ของ drafter + unit test ที่ยืนยันตัวอย่างใน guide · unit test ของคณิตศาสตร์ลูกเต๋า/ลิมิต/store/validation/render (ทดสอบ interaction ด้วยการคลิกจริงไม่ได้เพราะ repo ไม่มี jsdom)

**ไม่รวม (ชัดเจน):**

- **ไม่มี server roll** — v1 สุ่มฝั่ง client และเป็น **visual-only** ค่าที่ทอยไม่ได้ถูกบันทึกเป็นผลของโต๊ะจนกว่าการ์ดที่จะส่ง action จะ submit · server-authoritative roll คือ **F048** (งานถัดไป)
- **ไม่มี hidden roll / GM-only roll** — การ์ดทุกใบที่ผูก parameter เดียวกันในเบราว์เซอร์เดียวกันเห็นค่าเดียวกัน · ยังไม่มีการซ่อนค่าหรือสุ่มลับหลังบ้าน และไม่มีการแชร์ผลทอยข้ามสมาชิก
- **ไม่ persist draft** — store เป็น in-memory ต่อแท็บ/หน้า รีโหลดแล้วค่าที่ทอยไว้หาย (ไม่เขียน localStorage/sessionStorage เพื่อไม่ให้ค่าจากโต๊ะหนึ่งรั่วไปอีกโต๊ะ)
- **ไม่ใช้ Math.random** — ใช้ `crypto.getRandomValues` + rejection sampling เท่านั้น
- ไม่มี animation ต่อเนื่อง/เสียง/ภาพ 3D, ไม่มี advantage/disadvantage, ไม่มี exploding dice

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-22)

- `src/tabletop/shared/generative-contracts.ts` — `ControlDescriptor` เป็น discriminated union ของ button/form/slider/toggle/select; เพิ่ม `dice` เป็นสมาชิกใหม่แบบ additive ทำให้โปรแกรมเก่าอ่านได้เหมือนเดิม
- `src/tabletop/runtime/generative/schema.ts` — zod `strictObject` เป็นด่านแรกของ canvas; ต้องเพิ่ม member `dice` ไม่งั้นโปรแกรมที่ใช้ dice จะถูกปฏิเสธก่อนถึง validation
- `src/tabletop/runtime/generative/validation.ts` — control แต่ละตัวคำนวณ `interactiveParameters` แล้วเรียก `assertControlBinding`; dice ต้อง bind parameter ของตัวเองด้วย `{kind:"control"}` และ type ต้องเป็น `number`
- `src/tabletop/runtime/generative/evaluator.ts` — `EvaluatedControl` ส่ง descriptor + `inputValues` ต่อให้ UI โดยไม่ต้องแก้ (dice ไม่มี `value` expression)
- `src/tabletop/ui/GeneratedCanvasObjects.tsx` — `ControlsView` ถือ draft ของแต่ละ control ไว้ใน component ของ view นั้น การ์ดแต่ละใบจึงไม่เห็นค่ากันเองมาก่อน; งานนี้เพิ่ม `collectSharedControlValues()` + `controlValuesFor()` ให้ overlay ค่าจาก store
- `src/tabletop/ui/generated-canvas.css` — สไตล์การ์ด generated อยู่ในไฟล์เดียว; เพิ่มบล็อก `.tt-dice*` และ `@keyframes tt-dice-tumble`
- `server/providers/table-schema-guide.ts` — prompt guide ที่ drafter ใช้ทั้ง Node และ Cloudflare (ผ่าน `DeepSeekChangeProvider`); งานนี้เพิ่ม CONTROL dice, บล็อก `DICE:` และ `TABLE_DICE_EXAMPLE` ที่ interpolate เข้า guide และถูก assert ใน unit test

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F049-T1 | contract + zod + validation + shared dice maths | `npm test` ผ่าน: dice program ที่ถูกต้องผ่านทั้ง schema และ `validateGenerativeProgram`; faces/count/modifier นอกช่วง, parameter หาย, parameter ไม่ใช่ number ถูกปฏิเสธ |
| F049-T2 | การ์ด UI: stepper, ปุ่มทอย, หน้าลูกเต๋า, ผลรวม, reduced motion | render test เห็น `ทอย`, stepper, สูตร `2d6 + 1`; preview-only ถูก disable |
| F049-T3 | shared client draft store + ผูกกับการ์ดฟอร์ม | unit test ของ store แยกคีย์ตาม workspace/action/parameter; render test ว่าฟอร์มบนอีกการ์ดเห็นค่าที่ dice เขียน |
| F049-T4 | เอกสาร: feature doc นี้ + PLAN/CHANGELOG/spec | เอกสารระบุชัดว่า v1 สุ่มฝั่ง client/visual-only และ F048 เป็นงานถัดไป |
| F049-T5 | prompt guide: CONTROL dice + บล็อก `DICE:` + ตัวอย่างเดียวกับที่เทสต์ยืนยัน | `server/providers/table-schema-guide.test.ts`: program ที่สร้างจาก `TABLE_DICE_EXAMPLE` ผ่าน `tableChangeSchema` + `validateGenerativeProgram` และ form บน action เดียวกันยังผ่าน |

## ผลตรวจ

รันใน worktree นี้ด้วย Node **v22.23.2** (npm 11.0.0) เมื่อ 2026-10-22:

- `npm test` — **581 passed / 1 skipped** (86 passed / 1 skipped ไฟล์, รวม 87) จาก baseline 549 passed / 1 skipped; เพิ่ม 32 เทสต์ (3 ไฟล์ใหม่ของ dice/store/validation + 3 render test ใน `GeneratedCanvasObjects.test.ts` + 3 prompt-guide test)
- `npx vitest run src/tabletop/shared/dice.test.ts src/tabletop/ui/control-drafts.test.ts src/tabletop/runtime/generative/dice-validation.test.ts src/tabletop/ui/GeneratedCanvasObjects.test.ts` — **37/37**
- `npx vitest run server/providers/table-schema-guide.test.ts` — **3/3** (ตัวอย่างใน guide ตรงกับ `TABLE_DICE_EXAMPLE`, program ที่สร้างจากตัวอย่างผ่าน `tableChangeSchema` + `validateGenerativeProgram`, form บน action เดียวกันยังผ่านเมื่อไม่มี dice view)
- `npx tsc -b` — ผ่าน (exit 0)
- `npm run lint` — **0 error / 101 warning** (warning ทั้งหมดเป็น backlog เดิม; ไฟล์ที่แตะในงานนี้ lint สะอาด)
- `npm run build` — ผ่าน (public demo check 9 scenarios / 55 steps, typecheck App + server + cloudflare, vite build 4.98s)
- `node scripts/check-public-files.mjs` — `scannedFiles: 600`, `findings: []`

**ยังไม่ได้ตรวจ:** การคลิกจริงในเบราว์เซอร์ (repo ไม่มี jsdom/browser unit harness) — ต้องยืนยันด้วยตาในรอบ browser acceptance ก่อน merge · ยังไม่ได้ทดสอบว่า drafter จริงจะเลือกสร้าง dice เมื่อผู้ใช้ขอ (ต้อง live/corpus probe) และไม่ได้ทดสอบว่าค่าที่ทอยส่งไปถึง action จริงบน server ใน flow คลิก (ทดสอบแล้วเฉพาะ render + domain submit ด้วยค่าเดียวกัน)

## คำถามเปิด

- ควรให้การ์ด dice submit action เองหรือไม่ (v1 ตั้งใจให้เขียนเฉพาะ draft เพื่อไม่ให้การ์ดที่สุ่มฝั่ง client กลายเป็น authority โดยไม่ตั้งใจ)
- ต้องการ persistence ของ draft ข้ามรีโหลดหรือไม่ — ถ้าต้องการ ต้องผูกกับ `workspaceId + epoch` และตัดสินใจเรื่องข้อมูลข้ามโต๊ะ
- F048 ต้องตัดสินใจว่า server จะเก็บผลทอย (audit) หรือแค่รับค่าที่ client ส่งมาแล้วตรวจ bounds

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | v1 สุ่มฝั่ง client ด้วย `crypto.getRandomValues` และประกาศชัดว่า visual-only | ต้องการภาพ/การโต้ตอบก่อน; server-authoritative roll มีค่าใช้จ่ายเรื่อง contract/audit และเป็นงานแยก (F048) |
| 2026-10-22 | dice เป็น control ชนิดใหม่ใน `controls` view ไม่ใช่ view ชนิดใหม่ | ทุก view เป็นการ์ดอยู่แล้ว; ใช้ `controls` เดิมทำให้ layout/การจองการ์ดไม่เปลี่ยน และไม่ต้องแตะ `GenerativeViewDescriptor` |
| 2026-10-22 | เก็บ draft ข้ามการ์ดใน module store คีย์ `(workspaceId, actionId, parameterId)` ไม่เก็บลง server | ต้องให้การ์ดสองใบเห็นค่าเดียวกันโดยไม่เปลี่ยน contract ของ server และไม่แตะ state ของโต๊ะ |
| 2026-10-22 | ไม่ clamp ค่าที่ทอยได้ให้อยู่ใน min/max ของ parameter | การ clamp ทำให้ผลลูกเต๋าโกหก; แสดงคำเตือนและให้คนแก้ที่การ์ดที่ submit |
| 2026-10-22 | ให้ AI drafter เขียน `kind:"dice"` ได้ (guide + ตัวอย่าง + unit test) แต่ยังสุ่มฝั่ง client/visual-only | ใช้เคสจริงได้เร็วขึ้นโดยไม่ต้องรอ F048 · การที่ AI เขียน descriptor ได้ไม่เปลี่ยนว่าใครเป็น authority ของผลทอย |
