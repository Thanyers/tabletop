# F060 — การ์ดลูกเต๋าใช้ผลทอยจาก server เมื่อผูกกับ parameter ชนิด `roll`

| | |
| --- | --- |
| สถานะ | `review` (เสร็จในเครื่อง, branch `feat/F060-server-dice` — ยังไม่ push/merge) |
| เจ้าของฟีเจอร์ | lead (AI) — งานนี้ทำโดย subagent `dice-server` |
| เวอร์ชันที่คาด | **MAJOR — rollback ไม่สะอาด**: สัญญา JSON และ zod ไม่เปลี่ยน (control `kind:"dice"` มีอยู่แล้วใน F049) แต่รุ่นก่อน F060 จะปฏิเสธโปรแกรมที่เอา dice ไปผูก `roll` ตอนประเมิน canvas (`Dice must bind a numeric action parameter.`) ทำให้ `table.act` ของโต๊ะนั้นล้มด้วย `TABLE_GENERATIVE` จนกว่าจะแก้โปรแกรม · ไม่มี SQL migration/secret/binding |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F060` |

## ทำไม

F048 ให้ server เป็นเจ้าของผลทอย (`table.roll` → pending roll → `table.act` ใช้ผลนั้นครั้งเดียว) และ F049 ให้การ์ดลูกเต๋าแบบภาพที่สุ่มฝั่ง client ได้ แต่สองอย่างยังไม่เชื่อมกัน: การ์ด dice ผูกได้เฉพาะ parameter ชนิด `number` และสุ่มเองบนเครื่อง ผู้ใช้ที่เห็นการ์ดลูกเต๋าจึงได้ผลทอยที่ server ไม่รับรอง แม้ action นั้นจะมี `roll` parameter ที่ server พร้อมทอยให้อยู่แล้ว · F060 ปิดช่องนี้: ถ้า dice ผูกกับ `roll` parameter การ์ดจะใช้ `table.roll` เส้นเดียวกับ `RollParameterControl` และแสดงผลที่ server ส่งกลับมา

## สิ่งที่ผู้ใช้จะเห็น

1. การ์ด controls ที่มี dice ผูกกับ `roll` parameter แสดงสูตรจากโปรแกรม เช่น `Damage dice · 2d6 + 3 · server roll` — ไม่มี stepper จำนวน/หน้า เพราะค่าเหล่านั้นไม่ใช่ตัวกำหนดผลทอย
2. กด **ทอย** → เรียก `table.roll` ผ่าน dispatcher เดิม (busy, error, roll-store ชุดเดียวกับฟอร์ม action) → หน้าลูกเต๋าทีละลูกและผลรวมที่ได้จาก server ปรากฏพร้อมท่าทอยสั้น ๆ · กดอีกครั้งเป็น **ทอยอีกครั้ง** และแทนที่ pending roll เดิมของผู้ใช้คนนั้น
3. ค่าที่แสดงถูกล็อกจนกว่าจะทอยใหม่ และไม่ถูกเขียนลง shared draft store ของ parameter นั้น · การส่ง action ยังทำจากการ์ดฟอร์ม/การ์ดที่ submit action ซึ่ง server จะใช้ pending roll เอง (client ไม่ส่งค่าของ `roll` parameter)
4. dice ที่ผูกกับ `number` parameter ยังทำงานเหมือน F049 ทุกอย่าง: สุ่มบนเครื่องด้วย `crypto.getRandomValues`, เป็น visual-only, เขียน shared draft ให้การ์ดอื่นเห็นค่า

## ขอบเขต

**รวม:**

- validation: dice ผูกได้ทั้ง `number` และ `roll` parameter · เมื่อผูก `roll` ค่า `faces`/`count`/`modifier` ของ control ยังต้องอยู่ในช่วงและผ่าน `validateDiceSpec` แต่ **ไม่ใช่ authority** — การ์ดใช้ `parameter.roll` ของโปรแกรม
- UI: `DiceControl` แยกเป็นสองเส้นทางตามชนิด parameter · เส้นทาง `roll` ใช้ `onRoll`/`roll-store`/`table.roll` เดิม ไม่เรียก `rollDice` หรือ Web Crypto เลย และไม่เขียน draft
- test: validation ของ dice+roll และเคสปฏิเสธเดิม · render test ว่าการ์ดแสดงหน้าเต๋า/ผลรวมจาก roll-store (mock ด้วย `recordServerRoll`) และไม่มี marker ของเส้นทาง client · domain test ว่า action ใช้ pending roll ที่ server ออกให้
- เอกสาร: ไฟล์นี้ + PLAN/CHANGELOG/spec

**ไม่รวม (โดยเจตนา):**

- **ไม่เปลี่ยน wire contract**: payload/ack ของ `table.roll` และ `table.act` เหมือน F048 ทุกฟิลด์ · ไม่มีฟิลด์ใหม่ใน program, state หรือ event
- **ไม่ให้ dice เป็นตัว submit action**: การ์ด dice ยังเป็นแค่ที่มาของผลทอย/ภาพ การส่ง actionยังต้องมาจากการ์ดฟอร์มหรือปุ่มที่ผูก input ครบ (เหมือน F048/F049)
- **hidden roll / GM-only roll ยังไม่ทำ** — ผลทอยที่ server ส่งกลับยังเห็นได้เฉพาะคนที่กดทอย (ack) และไม่มีการแชร์ผลให้สมาชิกอื่นหรือซ่อนจากผู้เล่น
- dice ที่ผูก `number` ยังเป็น client-side/visual-only เหมือน F049 ไม่ถูกเปลี่ยนเป็น server roll
- ไม่มี advantage/disadvantage, exploding dice, หลาย roll ต่อ action หรือ animation ต่อเนื่อง/เสียง

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-22)

- `src/tabletop/runtime/generative/validation.ts` — branch `control.kind === 'dice'` เดิมบังคับ `item.type === 'number'`; F060 เปลี่ยนเป็นยอมรับ `number` หรือ `roll` และยังเรียก `validateDiceSpec(control)` ทุกกรณี · `assertControlBinding` มีกฎ F048 อยู่แล้วว่า `roll` parameter จับคู่กับ control ที่ประกาศชนิด `number` ได้
- `src/tabletop/runtime/generative/schema.ts` — zod ของ dice ไม่รู้จักชนิด parameter จึงไม่ต้องแก้ (faces/count/modifier ยังถูกตรวจที่เดิม)
- `src/tabletop/shared/roll.ts` — เพิ่ม `rollNotation()` ใช้ร่วมกันระหว่าง `RollParameterControl` และการ์ด dice (แสดง `2d6 + 3`)
- `src/tabletop/ui/GeneratedCanvasObjects.tsx` — `DiceControl` เดิมรวม logic client ไว้ทั้งหมด; F060 แยก `ServerDiceControl` (ใช้ `useServerRoll`, เรียก `onRoll`, แสดง `values`/`total` จาก `RollResult`) กับ `ClientDiceControl` (โค้ด F049 เดิม) และให้ `diceRollMode()` เป็นตัวตัดสินเส้นทาง · `disabledReason()` เดิมห้าม control ที่ไม่ใช่ form บน action ที่มี `roll`; F060 ยกเว้น dice ที่ผูก `roll` parameter ตัวนั้น
- `src/tabletop/ui/roll-store.ts` — `useServerRoll(view, actionId, parameterId)` คืนผลทอยล่าสุดและคืน `null` เมื่อ `dataRevision` เปลี่ยน; `TabletopApp.runCommand` บันทึกผลจาก ack ของ `table.roll` ลง store นี้
- `src/tabletop/domain/table.ts` — `table.act` ปฏิเสธค่าของ `roll` parameter (`TABLE_ROLL_CLIENT_VALUE`) และกิน pending roll ครั้งเดียวโดยตรวจ revision/expiry; ไม่ต้องแก้
- `server/providers/table-schema-guide.ts` — guide ของ drafter ระบุว่า dice ผูก `number` หรือ `roll` ได้ และบน `roll` ให้ server ทอย spec ของ parameter

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F060-T1 | validation + shared notation | `validateGenerativeProgram` ยอมรับ dice+roll, ยังปฏิเสธ parameter หาย/ชนิดผิดและ faces/count นอกช่วง · `rollNotation` ใช้ร่วมสอง control |
| F060-T2 | UI แยกเส้นทาง server/client | dice+roll เรียก `onRoll` (`table.roll`) และแสดง faces/total จาก roll-store; dice+number เหมือน F049; ไม่เขียน draft ในเส้นทาง roll |
| F060-T3 | test | render test เห็นค่าจาก `recordServerRoll` และไม่มี marker client path · domain test ว่า action ใช้ pending roll ที่ออกให้ · ชุดเดิมผ่านทั้งหมด |
| F060-T4 | เอกสาร | F060 + PLAN (`review`) + CHANGELOG ใต้ `Unreleased` + spec.md ระบุ number dice ยัง client-side/visual-only และ hidden roll ยังไม่ทำ |

## ผลตรวจ

รันใน worktree `.worktrees/dice-server` ด้วย **Node v22.23.2** (รุ่นเดียวกับ CI) เมื่อ 2026-10-22:

- `npm test` — **645 passed / 1 skipped** (89 passed / 1 skipped ไฟล์ จาก 90) · เพิ่มเทสต์จาก baseline: dice+roll validation, dice card render (server values), client-path guard
- `npx tsc -b` — ผ่าน (exit 0)
- `npm run lint` — **0 error / 103 warning** (warning ทั้งหมดมาจากไฟล์เดิม; `eslint` บนไฟล์ที่แตะในงานนี้ผ่านสะอาด)
- `npm run build` — ผ่าน (public demo check, typecheck App + server + cloudflare, vite build)
- `node scripts/check-public-files.mjs` — `scannedFiles: 619`, `findings: []`

**ยังไม่ได้ตรวจ:** การคลิกจริงในเบราว์เซอร์ (repo ไม่มี jsdom/browser unit harness) — render test เป็น static markup และ mock roll-store · ยังไม่ได้ยืนยันว่า drafter จริงจะเลือกเขียน dice ผูก `roll` เมื่อผู้ใช้ขอ

## คำถามเปิด

- ควรให้การ์ด dice ที่ผูก `roll` parameter ส่ง action เองได้หรือไม่ (ตอนนี้ยังต้องมีการ์ดฟอร์ม/ปุ่มแยก เพื่อคงหลัก "การ์ดที่ทอยไม่ใช่การ์ดที่ยืนยัน")
- ต้องการแสดง hidden roll/GM-only roll หรือไม่ — ยังอยู่นอกขอบเขต
- ควรบังคับให้ `faces`/`count` ของ dice บน `roll` parameter ตรงกับ spec หรือไม่ — v1 เลือกไม่บังคับ (เก็บไว้เป็น display default ที่ต้อง valid) เพื่อไม่ให้โปรแกรมเก่าที่เคยผูก dice กับ number แล้วเปลี่ยน parameter เป็น roll ถูกปฏิเสธ

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | dice ผูก `roll` ได้ แต่ faces/count ของ control ไม่ใช่ authority | ลดการแก้โปรแกรม/zod และไม่ต้องประสานลิมิตสองชุด; การ์ดอ่าน spec จาก `parameter.roll` ที่ server ใช้จริง |
| 2026-10-22 | เส้นทาง server ใช้ `useServerRoll` + `onRoll` เดิมของ `RollParameterControl` | ได้ busy/error/ack/projection/stale rules เดิมทั้งหมดโดยไม่แตะ wire contract หรือ store ใหม่ |
| 2026-10-22 | การ์ด dice บน `roll` parameter ไม่เขียน shared draft | ค่าของ roll parameter เป็นของ server; การเขียน draft จะทำให้การ์ดอื่นเห็นค่าที่ไม่ใช่ pending roll และเสี่ยงส่งค่าผิดสัญญา |
| 2026-10-22 | เก็บ dice+number เป็น client-side/visual-only | F049 ใช้งานได้อยู่และไม่มีความเสี่ยงเรื่อง authority; การเปลี่ยนเป็น server roll จะต้องมี parameter ชนิด roll ซึ่งเป็นการเปลี่ยนโปรแกรม |
| 2026-10-22 | ไม่แตะ zod ของ control dice | schema เดิมตรวจ faces/count/modifier ได้โดยไม่ต้องรู้ชนิด parameter; การเพิ่มข้อมูลชนิด parameter ลง schema จะทำให้โปรแกรมเก่าเสีย |
