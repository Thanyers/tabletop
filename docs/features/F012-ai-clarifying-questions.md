# F012 — AI ถามกลับแทนการร่างกฎเมื่อโจทย์ยังไม่พอ

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | JitrudeeDongdee (Claude) |
| เวอร์ชันที่คาด | MINOR — เพิ่มผลลัพธ์แบบใหม่ของ AI ไม่เปลี่ยน schema ถาวร rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F012` |

## ทำไม

เมื่อเจ้าของโต๊ะขอให้ AI ร่างกฎจากโจทย์ที่กำกวม หรือวางข้อมูลทั้งไฟล์ลงในข้อความแทนการแนบไฟล์ AI จะพยายามร่างอยู่ดี ตัวตรวจของ server ปฏิเสธ ระบบให้ AI แก้ซ้ำอีก 2 รอบ (เสียเงินทั้ง 3 รอบ) แล้วจบด้วยข้อความ "The proposed table rules did not pass validation" ซึ่งไม่บอกผู้ใช้ว่าต้องเปลี่ยนโจทย์อย่างไร (พบ 2026-10-20 ตอนทดสอบใน emulator: โต๊ะไม่มีไฟล์ วาง CSV ในแชท ได้ `MODEL_PROVIDER_OUTPUT_REJECTED`)

## สิ่งที่ผู้ใช้จะเห็น

1. พิมพ์คำขอร่างกฎที่ยังไม่พอ
2. แทนการ์ด error จะได้การ์ด "A few details would help build this table. Nothing on the table changed." พร้อมคำถาม 1–3 ข้อจาก AI ในภาษาเดียวกับคำขอ
3. กดคำถาม → ช่องแชทได้คำขอเดิม + คำถามนั้น → พิมพ์คำตอบต่อท้ายแล้วส่ง (โหมดร่างกฎไม่ส่งประวัติแชท จึงต้องรวมไว้ในข้อความเดียว)

## ขอบเขต

**รวม:** โต๊ะชนิด `table` โหมดร่างกฎ (`/model`) ทั้งรอบแรกและรอบซ่อม · **ไม่รวม:** โหมดถาม (`ask`), โต๊ะ invoice/teaching/encounter, การเก็บรายการปัญหาของตัวตรวจ, การกันไม่ให้วาง CSV ลงแชทฝั่ง client

## ข้อเท็จจริงจากโค้ด (2026-10-20)

- `server/providers/deepseek-changes.ts` — prompt ของโต๊ะบอกให้ตอบ `{"kind":"clarify","questions":[...]}` เมื่อโจทย์ไม่พอหรือวางข้อมูลแทนการแนบไฟล์ · ตรวจด้วย `tableClarifySchema` (1–3 ข้อ, 3–200 ตัวอักษร) · ผลลัพธ์ `DeepSeekChangeResult` เป็น union `{change}` | `{questions}`
- `cloudflare/ai.ts` — `proposeGeneratedTable` คืน `{questions}` ทันทีหลัง settle ค่าใช้จ่าย ไม่รันตัวตรวจกฎ · โต๊ะชนิดอื่นถ้าได้ `questions` ถือว่า output ไม่ผ่าน
- `cloudflare/room.ts` — job ที่ได้คำถามจบเป็น `completed` โดยไม่ commit อะไร เก็บ `questions` ใน `model_jobs.data` (JSON เดิม ไม่เพิ่ม schema) · `modelJobView` ส่ง `questions` ให้ client
- `src/tabletop/ui/useTableChat.tsx` — การ์ดแสดงคำถามเป็นปุ่ม ไม่ refresh โต๊ะเมื่อได้คำถาม

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F012 | contract + UI + เทสต์ | unit: provider รับ/ปฏิเสธ clarify, ai.ts คืน questions และคิดเงินรอบเดียว, room job จบ `completed` พร้อม `questions` ไม่มี candidate · browser: mock provider ตอบ clarify → การ์ดคำถามขึ้น, กดแล้วช่องแชทได้ข้อความรวม, โต๊ะไม่เปลี่ยน |

## คำถามเปิด

- ควรเก็บสถิติว่า AI ถามกลับบ่อยแค่ไหนไหม เพื่อปรับ prompt

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-20 | ให้ AI ถามกลับแทนการร่างตั้งแต่แรก (ไม่ใช่ข้อความ error หรือคำถามสำเร็จรูป) | ผู้ใช้เลือก · ให้คำถามเจาะจงกับไฟล์และคำขอ |
| 2026-10-20 | กดคำถามแล้วรวมคำขอเดิม + คำถามไว้ในข้อความเดียว | โหมดร่างกฎไม่ส่งประวัติแชทให้ AI ([GENERIC_TABLE_DESIGN](../GENERIC_TABLE_DESIGN.md#table-conversation-and-requested-actions)) |
| 2026-10-20 | อนุญาตให้ถามกลับได้ในรอบซ่อมด้วย | ถ้าซ่อมไม่ได้ การถามดีกว่าจบด้วย error และไม่เสียเงินรอบที่เหลือ |
