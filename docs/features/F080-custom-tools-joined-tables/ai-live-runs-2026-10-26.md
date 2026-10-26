# Live AI authoring runs — 2026-10-26

บันทึกการรัน **โมเดลจริง** ผ่าน `server/providers/author-tool-package-cli.ts` (คีย์อยู่ใน `.dev.vars` ซึ่ง gitignore) เพื่อเป็นหลักฐานถาวรแทน `test-results/` ที่ถูกล้างได้

## ผล

| intent | model | package | ไฟล์/behaviour/port | hash | calls | USD |
|---|---|---|---|---|---|---|
| a room planner that shows which rooms are free and lets me reserve one | deepseek-chat (flag) | room-planner | 2/1/1 | `205516f4924e…` | 1 | 0.000673 |
| keep everything, but show the room capacity next to each free room (continuation) | deepseek-chat (flag) | room-planner | 2/1/1 | `5b9d65c21966…` | 1 | 0.001104 |
| a small checklist tool for opening the room | default (deepseek-chat) | room-opening-checklist | 2/1/1 | `fb5f8092e1ca…` | 1 | 0.000676 |

**รวม**: 3 calls · **USD 0.002453** (+ การรันที่ล้มเหลว 1 ครั้ง USD 0.000432 จาก prompt ที่ยังหลวม) — เพดานที่อนุมัติคือ 3 runs × ≤6 calls × ≤USD 0.20 ต่อ run

## สิ่งที่พิสูจน์

1. **intent → package ที่ validate ผ่าน** ได้จริง และใช้ได้กับ intent ที่ต่างกัน (room planner / checklist) ไม่ใช่กรณีเดียว
2. **continuation** สร้างบน base เดิม: packageId/behaviour เท่าเดิม แต่ UI เปลี่ยนจริง (มีคำว่า capacity) — ตรวจด้วยการเทียบไฟล์ ไม่ใช่เชื่อคำตอบโมเดล
3. **ค่าเริ่มต้นใช้งานได้**: รันครั้งที่ 3 ไม่ส่ง flag ใด ๆ ก็ผ่าน (ค่าเริ่มต้นเป็น `deepseek-chat` + 8000 tokens ตาม D-042)

## สิ่งที่เรียนรู้ (บันทึกใน D-042)

- บัญชีนี้ตอบ `deepseek-flash` ผ่าน reasoning model ⇒ `content` ว่างเมื่อ budget หมดไปกับการคิด
- prompt ต้องมี **skeleton JSON เต็ม** ที่ตรงกับ schema ไม่งั้นโมเดลจะแต่งโครงสร้างเองและถูก validator ปฏิเสธ

## วิธีรันซ้ำ

```bash
DEEPSEEK_KEY=<key> npx tsx server/providers/author-tool-package-cli.ts "<intent>" [--base pkg.json] [--model <name>] [--max-tokens <n>] [--json out.json]
```
