# F041 — เพดาน response ของ assistant นับเฉพาะคำตอบ ไม่ใช่ JSON ของ SSE

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — แก้เพดานฝั่ง server ไม่แตะ schema/migration/binding |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F041-T1` |

## ทำไม

หลัง deploy 4.3.1 (แก้ notes) ผู้ใช้ส่งคำขอเดิมอีกครั้งแล้วได้
`MODEL_PROVIDER_RESPONSE_TOO_LARGE` ภายใน ~3 วินาที ทั้งที่คำตอบยังสั้น

วัดจริงกับ `deepseek-flash` (thinking disabled, `max_tokens: 8192`, stream):

| | ค่า |
| --- | ---: |
| completion tokens | 188 |
| ตัวอักษรคำตอบ | 554 |
| events | 190 |
| **raw SSE bytes** | **55,890** |

แปลว่า SSE envelope กิน ~294 bytes/token และเพดานเดิม `MAX_RESPONSE_BYTES = 64 KiB`
ใน `cloudflare/table-assistant.ts` ถูกชนที่คำตอบไทยราว **200–220 tokens** — ไม่เกี่ยวกับ token cap ของโมเดลเลย
(เหตุผลที่เห็นใน 3 วินาที: stream ถูกตัดกลางทางหลังจากผ่าน 64 KiB)

## สิ่งที่เปลี่ยน

| จุด | เดิม | ใหม่ |
| --- | ---: | ---: |
| `MAX_RESPONSE_BYTES` (raw SSE guard) | 64 KiB | **16 MiB** |
| `MAX_CONTENT_CHARS` (คำตอบที่ถอดแล้ว) | — | **256,000** |
| `MAX_OUTPUT_TOKENS` (assistant) | 8,192 | **32,768** |
| `MAX_TIMEOUT_MS` (assistant call) | 120s | **180s** (< job recovery 240s และ poll 250s) |
| billing `MAX_OUTPUT_TOKENS` | 32,768 | คงเดิม (พอสำหรับ 32,768) |

ไม่ได้เปลี่ยนเพดานของเส้นทางร่างกฎ (`server/providers/deepseek-changes.ts`, 32,768 output / 180s / 48 KB input)
เพราะหลักฐานชี้ว่าไม่ได้ชนเพดานนั้น และการขยายโดยไม่มีหลักฐานจะทำให้ช้าลงโดยไม่จำเป็น

## ผลตรวจ

- `npx vitest run --config vitest.cloudflare.config.ts cloudflare/table-assistant.test.ts` — **14/14**
  รวม regression ใหม่: stream ที่ envelope > 64 KiB แต่คำตอบเล็ก ต้องผ่าน
- `npm run test:cloudflare` — **113/113**
- `npm test` — **520 passed / 1 skipped** (Node 22.23.2)
- `npm run typecheck` / `npm run build` ผ่าน
- `npm run lint` รันในเครื่องไม่ได้ (ไม่มี `eslint` ใน `node_modules`) — CI เป็นผู้รัน

## ความเสี่ยง

- raw cap 16 MiB เป็นเพียงกันหน่วยความจำ; คำตอบจริงถูกจำกัดด้วย `MAX_CONTENT_CHARS` และ 32K tokens
- ผู้ให้บริการที่ส่ง event ใหญ่ผิดปกติจะยังถูกตัดที่ 16 MiB
- ยังไม่ได้ยิง production ซ้ำ; ต้อง merge release แล้วให้ผู้ใช้ลองคำขอเดิม
