# F048 — ลูกเต๋าที่ server ทอยให้เป็น parameter ของ action

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | roll-backend (AI) |
| เวอร์ชันที่คาด | MAJOR — ไม่มี SQL migration/secret/binding แต่ **rollback ไม่สะอาด**: zod ของรุ่นเก่าเป็น `strictObject` และ enum ของ parameter ไม่มี `roll` โปรแกรมที่มีพารามิเตอร์นี้จะถูกปฏิเสธทั้งโปรแกรม (การ์ด canvas ไม่ขึ้น, assistant ของโต๊ะนั้นตอบ "invalid rules") จนกว่าจะเอา parameter นี้ออก · เทียบกับ [F040](F040-scene-motion.md) ที่เป็นลักษณะเดียวกัน |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F048` |

## ทำไม

โต๊ะข้อมูลที่ AI สร้างมี action ที่ต้อง "ทอยลูกเต๋า" (โจมตี, เก็บของ, ตรวจทักษะ) แต่ตอนนี้ไม่มีที่ให้ค่าเหล่านี้เกิดจากระบบเลย: control ทุกชนิดเป็นค่าที่คนพิมพ์/เลือกเอง ถ้าให้ client ทอยเองและส่งมา server ก็เชื่อไม่ได้ (แก้ตัวเลขได้) และประวัติก็แยกไม่ออกจากค่าที่คนกรอก · F048 จึงให้ **server เป็นคนทอย** เก็บผลไว้ชั่วคราว แล้วให้ action ที่ส่งมาใช้ผลนั้นครั้งเดียว

## สิ่งที่ผู้ใช้จะเห็น

1. ฟอร์ม action ที่มี parameter ชนิด `roll` แสดงกล่อง "Damage roll · 2d6 + 3 · server roll" พร้อมปุ่ม **ทอย**
2. กด **ทอย** → server สร้างลูกเต๋าทุกตัวด้วย `crypto.getRandomValues` แล้วส่งผลกลับมาเป็นลูกเต๋าทีละลูก + ผลรวม ค่าถูกแสดงแบบอ่านอย่างเดียวและ **ล็อกไว้จนกว่าจะกด "ทอยอีกครั้ง"**
3. กดส่ง action → แถวใหม่/ค่าที่เปลี่ยนใช้ผลรวมจาก server (ไม่ใช่ค่าที่ client ส่ง) · ถ้าไม่ได้ทอย, ทอยแล้วหมดอายุ, โต๊ะเปลี่ยนข้อมูลไปแล้ว หรือพยายามส่งค่ามาเอง ระบบตอบ error เป็นรหัสชัดเจน
4. ทอยซ้ำ = แทนที่ผลเดิมของผู้ใช้คนนั้นสำหรับ action/parameter เดียวกัน (ยังไม่กินสิทธิ์); ใช้แล้วใช้ซ้ำไม่ได้

## ขอบเขต

**รวม:** `TableParameter.type = 'roll'` + `roll { groups: {count, faces}[], modifier? }` · ขอบเขต 1–4 groups, count 1–10, faces 2–100, รวมลูกเต๋า ≤ 20, modifier เป็นจำนวนเต็ม |modifier| ≤ 1000 · คำสั่ง `table.roll` (server authority เดียวกับ `table.act`) · pending roll ใน state ห้องพร้อม `dataRevision` + อายุ 10 นาที · การกิน pending roll แบบ single-use/revision-checked/expiry-checked ตอน `table.act` · ปฏิเสธค่าที่ client ส่งมาให้ roll parameter · เก็บหน้าเต๋า+ผลรวมลง event ของคำสั่ง (provenance/replay) · UI ขั้นต่ำ (ปุ่มทอย, ลูกเต๋า, ผลรวม, ล็อกค่า) · prompt guide + ตัวอย่างโจมตีสั้น ๆ · unit/authority/room test

**ไม่รวม:** การทอยฝั่ง client (โดยเจตนา — ต้องเป็น server เท่านั้น), หลาย roll ต่อหนึ่ง action (จำกัด 1 เพื่อให้ payload/ack ชัดเจน), advantage/disadvantage หรือ exploding dice, การเก็บ pending roll ข้าม request ในฐานข้อมูลแยก, การทอยใน private trial preview (ปิดปุ่มใน preview), การให้ AI assistant *เสนอ* action ที่มี roll parameter (ยังทำไม่ได้เพราะการยืนยันต้องมี pending roll จาก server), browser acceptance ของ UI ใหม่

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-22)

- `src/tabletop/shared/table-contracts.ts` — `TableParameter` เป็น union ชนิดเดิม text/number/boolean/record; `TableState` มี `dataRevision`, `actionRevision`, `activity`
- `src/tabletop/domain/table.ts` — zod เป็น authoritative (`tableProgramSchema`, `parameterSchema`); `checkProgram` ตรวจความสอดคล้องของชนิด operand/effect; `table.act` ตรวจ input แล้ว resolve effect/creates ด้วย `resolve()`
- `src/tabletop/runtime/generative/validation.ts` — `parameterType` และ `assertControlBinding` กำหนดชนิดของ control ต่อ parameter
- `server/authority.ts` — `publicCommands.table` เป็น allowlist ของคำสั่ง; `commitDecision` เขียน `event_data` ลงตาราง `events` (Node) และ forward ไป Room (`room_events`)
- `cloudflare/room.ts` — ใช้ `CommandAuthority` ตัวเดียวกับ Node จึงได้คำสั่งใหม่โดยไม่ต้องมี endpoint เพิ่ม
- `src/tabletop/ui/GeneratedCanvasObjects.tsx`, `src/tabletop/ui/TableCanvasObjects.tsx` — ฟอร์ม action สองที่ (generated controls และการ์ด Actions) ใช้ `TableParameter` ชุดเดียวกัน
- `server/providers/table-schema-guide.ts` — prompt guide ที่โมเดลอ่าน (zod ยังเป็นตัวจริง)

## ลำดับการทำงาน

1. **ทอย:** client ส่ง `table.roll {actionId, parameterId}` · authority ตรวจสมาชิก/role/`table.act`/requireTurn/ชนิด parameter · `domain/roll.ts` สร้างลูกเต๋าทุกตัวจาก `crypto.getRandomValues` (rejection sampling ให้แต่ละหน้าเท่ากัน) · เก็บ `TablePendingRoll` ใน `TableState.pendingRolls` ผูก `(actorId, actionId, parameterId)` พร้อม `dataRevision` และ `expiresAt = now + 10 นาที` · ตอบ `{ groups, values, total }` ใน `CommandAck.roll` **เฉพาะคนที่ทอย**
2. **ทอยซ้ำ:** รายการเดิมของ actor/action/parameter ถูกแทนที่ (ไม่กินเพดาน) · เก็บได้สูงสุด 32 รายการที่ยังไม่หมดอายุต่อโต๊ะ
3. **ส่ง action:** `table.act` ต้องไม่มี key ของ roll parameter (มี = `TABLE_ROLL_CLIENT_VALUE` 422) · server หา pending roll ของ actor นั้น ตรวจว่า `dataRevision` ยังตรง ไม่หมดอายุ และหน้าเต๋า/ผลรวมตรงกับที่บันทึก (กัน state ถูกแก้) · ใส่ `total` เป็นค่าของ input แล้วรันเงื่อนไข/effect/create ตามปกติ · ลบ pending roll เมื่อ commit สำเร็จ (single use)
4. **Provenance:** event ของ `table.roll` และ `table.act` เก็บ `payload.roll = { parameterId, groups, values, total }` · event ของ `table.act` เก็บ `payload.inputs` โดย **ไม่มี** ค่า roll · หน้าเต๋าและผลรวมจึงย้อนกลับได้จาก event อย่างเดียว
5. **Replay:** แถวที่สร้างใช้ id จาก `actionRevision` + hash ของ action/field เดิม และค่าที่ใช้คือผลรวมที่บันทึกไว้ → รัน `handleTableCommand` ซ้ำบน state + pending roll ชุดเดิมได้แถวและค่าเดียวกัน (deterministic)

## ขีดจำกัด

| สิ่งที่จำกัด | ค่า | เหตุผล |
| --- | --- | --- |
| groups ต่อroll | 1–4 | ให้ notation อ่านง่ายและ prompt สั้น |
| ลูกเต๋าต่อ group | 1–10 | กันฟอร์ม/ผลลัพธ์ยาวเกิน |
| หน้าเต๋า | 2–100 | d2 ถึง d100 ครอบเกมบนโต๊ะ |
| ลูกเต๋ารวม | ≤ 20 | จำกัดงานคำนวณและการแสดงผล |
| modifier | จำนวนเต็ม −1000..1000 | ผลรวมยังอยู่ใน safe integer |
| อายุ pending roll | 10 นาที | กัน state ค้างและ replay เก่า |
| pending roll ต่อโต๊ะ | 32 | state มีขอบเขต |
| roll parameter ต่อ action | 1 | payload/ack ต่อ action ชัดเจน |

## Fore-and-back compatibility

- **Forward (รุ่นใหม่่อ่านข้อมูลเก่า):** โปรแกรม/ห้องที่ไม่มี `pendingRolls` หรือ parameter `roll` ทำงานเหมือนเดิมทุกอย่าง (field ใหม่เป็น optional; zod ไม่ได้บังคับ)
- **Backward (รุ่นเก่าอ่านข้อมูลใหม่):** zod enum ของ parameter รุ่นเก่าไม่มี `roll` และเป็น `strictObject` → โปรแกรมที่มี parameter นี้จะถูกปฏิเสธทั้งโปรแกรม การ์ด Rules/canvas จะไม่แสดงและ assistant ของโต๊ะนั้นจะตอบว่า rules ไม่ถูกต้อง · การ rollback ไปรุ่นก่อน F048 จึงต้องลบ parameter นี้ออกจากโปรแกรมก่อน หรือออกรุ่นใหม่ · เอกสารนี้จึงจัดเป็น **MAJOR** ตาม [AGENTS.md §5](../../AGENTS.md#5-ออก-release)

## ผลตรวจ

รันใน worktree `.worktrees/dice-roll` ด้วย **Node v22.23.2** (รุ่นเดียวกับ CI):

- `npm test` — **564 passed / 1 skipped** (83 passed / 1 skipped test files) รวม `src/tabletop/domain/table-roll.test.ts` 12 เคส (bounds, permission/turn, ไม่มี pending roll, ค่าที่ client ส่ง, ใช้ซ้ำ, หมดอายุ, stale, pending roll ถูกแก้, replay, การทอยซ้ำ/เพดาน, ค่าเก่าไม่กระทบ) และ `src/tabletop/ui/GeneratedCanvasObjects.test.ts` เคส UI ของปุ่มทอย/ล็อกค่า
- `npx tsc -b` (และ `tsc -p tsconfig.server.json`, `tsc -p tsconfig.cloudflare.json`) — ผ่านทั้งสามชุด ไม่มี error
- `npm run lint` — **0 errors, 101 warnings** (เท่ากับ baseline เดิม; ไม่มี warning จากไฟล์ที่เพิ่ม)
- `npm run build` — ผ่าน (typecheck + vite build)
- `node scripts/check-public-files.mjs` — สแกน 600 ไฟล์, **findings: []**
- `npm run test:cloudflare` (เช็คเพิ่มเติมนอกชุดบังคับ) — **117 passed / 117** (8 test files) รวม `cloudflare/room.test.ts` เคส `table.roll` → `table.act` → ตรวจ `room_events` ว่ามี `payload.roll` และ `payload.inputs` ไม่มีค่า roll
- `server/authority.test.ts` เคส F048 ครอบ HTTP path จริง: `table.roll` 200 + ค่าในช่วง, member projection ไม่มี pending roll, ค่าที่ client ส่ง 422, submit สำเร็จแล้วแถวมีผลรวม, event มีหน้าเต๋า/ผลรวม, ใช้ซ้ำ 409, ทอยแล้วเวลาเกิน 10 นาที → 409

ยังไม่ได้รัน browser acceptance ของ UI ใหม่ (ปุ่มทอย/กล่องลูกเต๋า) — ตรวจด้วย static render test เท่านั้น

## คำถามเปิด

- ควรให้ AI assistant เสนอ action ที่มี roll parameter ได้หรือไม่ (ต้องมีขั้น "ทอย" ก่อนยืนยัน ซึ่งยังไม่มีใน flow ของ assistant)
- ต้องการหลาย roll ต่อ action (เช่น attack + damage) หรือไม่ — ตอนนี้จำกัด 1
- ควรแสดง pending roll ของตัวเองใน projection (ไม่ใช่แค่ ack) เพื่อให้ reload แล้วเห็นผลเดิมหรือไม่ — ตอนนี้เลือกซ่อนเพราะเป็นค่าส่วนตัวและ ack ตอบคนทอยเท่านั้น

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | เก็บ pending roll ใน `TableState` ไม่ใช่ตารางใหม่ | ได้ atomicity จาก command transaction เดิม, ใช้ได้ทั้ง Node (PGlite/Postgres) และ Durable Object โดยไม่มี SQL migration; projectDomain ตัดออกเพื่อไม่ให้สมาชิกคนอื่นเห็น |
| 2026-10-22 | `table.roll` ไม่บวก `dataRevision` | การทอยไม่เปลี่ยนข้อมูลร่วม; ถ้าบวก ทอยของสมาชิกคนอื่นจะ stale ทันที · ผูกด้วย revision ตอนทอยและตรวจตอนใช้ |
| 2026-10-22 | ให้ `total` เป็นค่าของ input (ชนิด number) | เงื่อนไข/effect/create ใช้ `{input: rollParam}` ได้เหมือน number ปกติ ไม่ต้องมี operand ชนิดใหม่ |
| 2026-10-22 | เก็บหน้าเต๋าลง event ของ `table.act` และ `table.roll` | ใช้โครงสร้าง event เดิมที่มีอยู่แล้ว (ไม่ต้องมี storage ใหม่) และพอสำหรับ replay/ตรวจย้อนหลัง |
| 2026-10-22 | ใช้ rejection sampling กับ `crypto.getRandomValues` | `% faces` ตรง ๆ จะเอียงเข้าหน้าต่ำ; ตรวจหน้าเต๋า/ผลรวมซ้ำตอนกิน pending roll เพื่อกัน state ถูกแก้ |
| 2026-10-22 | จำกัด 1 roll parameter ต่อ action | ทำให้ `CommandAck.roll` และ event payload มีความหมายเดียว ไม่ต้องออกแบบ array/หลาย pending roll ต่อ action |
| 2026-10-22 | UI เก็บผลที่ได้จาก ack ไว้ใน module store ต่อ (workspace, actor, action, parameter) | ไม่ต้องเปลี่ยนสัญญา `Command`/prop drilling ทั้งต้นไม้; ค่าเดิมถือว่า stale เมื่อ `dataRevision` เปลี่ยน ตรงกับกฎของ server |
