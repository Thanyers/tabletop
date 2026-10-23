# F064 — ค้นเว็บเองเมื่อโจทย์ต้องใช้ข้อเท็จจริงภายนอก

| | |
| --- | --- |
| สถานะ | `review` — T1–T4 merge แล้ว (#207) · สไลซ์ A เปิด draft PR [#211](https://github.com/Thanyers/tabletop/pull/211) |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — ใช้ `DEEPSEEK_KEY` เดิม ไม่มี secret/binding/migration ใหม่ |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F064-T*` |
| ต่อจาก | [F050](F050-live-thinking.md) (ช่อง progress เดียวกัน), [F012](F012-ai-clarifying-questions.md) (ถามกลับแทนการเดา) |

## ทำไม

ก่อน F064 โมเดลร่างกฎ/ตารางเห็นแค่คำขอ + ไฟล์ + โน้ต และถูกสั่งตรง ๆ ว่า *"Do not invent source facts… Without files, build the requested hypothetical example and state assumptions"* (`server/providers/deepseek-changes.ts`) ทำให้โจทย์ที่ต้องใช้ข้อเท็จจริงภายนอก (เกณฑ์ WHO, อัตรา VAT ปีนี้, ค่าคงที่ฟิสิกส์) ได้คำตอบแบบ "สมมติฐาน" ทั้งที่ผู้ใช้ต้องการคำตอบจริง

ผู้ใช้ต้องการให้การค้นเว็บเป็นเรื่อง **native** เหมือน harness: ถ้าโจทย์ต้องใช้ก็ค้นเอง ไม่ต้องมีปุ่มหรือขั้นตอนแยก

## สิ่งที่ผู้ใช้จะเห็น

1. ขอตารางที่ต้องใช้ข้อเท็จจริงภายนอก → ระบบค้นเว็บเองก่อนร่าง แล้วร่างจากหลักฐานที่ได้ (ไม่ใช่ความจำของโมเดล)
2. คำขอที่อิงไฟล์/เลขที่ให้มา → ไม่ค้น (มีหลักฐานยืนยันจากการทดลองว่าโมเดลเลือกเองถูกบริบท)
3. ค้นไม่เจอ → ตารางยังออก แต่ระบุ "ไม่ทราบ" ใน `assumptions` แทนการเดา
4. ระหว่างรอร่าง การ์ดบอกสด ๆ ว่า **กำลังค้นอะไร เจอเท่าไร** แล้วจบด้วยจำนวนแหล่งที่ใช้ (สไลซ์ A — ดูหัวข้อถัดไป)

## ขอบเขต

**รวม:** search adapter (normalize/rank/citation matching) · research tool loop แบบ bounded · ช่อง `research` ใน input ของ drafter + บรรทัดกำกับใน system prompt · env `TABLE_WEB_SEARCH=off` ปิดได้

**ไม่รวม:** ให้ผลค้นเว็บกลายเป็น `program.evidence` (evidence ต้องอ้าง source ที่มีในโต๊ะ; ต้องออกแบบการ import source ก่อน) · UI แสดงแหล่งบนการ์ดร่าง · เปิด tool calling ในสตรีมร่างหลัก (research เป็นขั้นก่อนร่าง)

## ข้อเท็จจริงจากโค้ด (2026-10-23, `origin/dev` `c5c8803`)

| ชั้น | สภาพก่อน F064 |
| --- | --- |
| `server/providers/deepseek-changes.ts` | `tool_choice:'none'`, `response_format:json_object`, input เป็น `strictObject` ต่อ kind |
| `cloudflare/ai.ts` | `proposeChange` → reserve → dispatch → `proposeGeneratedTable`; วัดขนาดด้วย `measureDeepSeekChangeRequest` |
| `cloudflare/contracts.ts` | `Env` มี `DEEPSEEK_KEY`, `AI_TABLE_DEADLINE_MS`, `TABLE_READ_ONLY` |
| การค้นเว็บ | ไม่มีเลยในทั้ง repo |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | ใช้ DeepSeek Search & Fetch (`POST /v1/tools/search`) | บิล/key เดียวกับโมเดล, $0.75/1,000 คำขอที่สำเร็จ, QPS 100, คืน `authority`/`date`/`rerank_score`/`summary` ที่ใช้ตรวจ citation ได้ |
| 2026-10-23 | research เป็นขั้นก่อนร่าง ไม่เปิด tool calling ในสตรีมร่าง | สตรีมร่างเดิมมี repair/progress/เพดานเวลา; การแทรก tool loop ในนั้นเสี่ยงกว่าและไม่ได้ประโยชน์เพิ่ม |
| 2026-10-23 | normalize URL ก่อนเทียบ citation | ผู้ให้บริการคืน `…&lang=EN(accessed` และโมเดลเขียน `#fragment` ออก ⇒ exact match ใช้ไม่ได้ |
| 2026-10-23 | กรอง `authority < 3` และ `rerank_score < 1.5` | ผลค้นเอาของคุณภาพต่ำ (เช่น PDF ที่แค่มีคำค้น) ขึ้นก่อนแหล่งทางการ |
| 2026-10-23 | research ล้มแล้วร่างต่อได้ | การค้นเป็นส่วนเสริม ไม่ควรทำให้ร่างล้ม |
| 2026-10-23 | ปิด research เมื่อมี `fetchImpl` ที่ถูกฉีดเข้ามา | เทสต์ทุกตัวฉีด fetch ปลอม; กันไม่ให้ชุดเทสต์ยิงเน็ต |

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F064-T1 | `web-search.ts` + เทสต์ | normalize/rank/match ผ่าน 11 เคส รวม URL เพี้ยนที่พบจริง |
| F064-T2 | `deepseek-research.ts` + เทสต์ | tool ถูกเสนอ/ถูกถอดตามงบ, ปฏิเสธ citation นอกผลค้น, 5 เคส |
| F064-T3 | ช่อง `research` ใน input + prompt + env switch | เทสต์ยืนยันว่า research อยู่ใน body และถูกนับใน `measureDeepSeekChangeRequest` |
| F064-T4 | เอกสาร + PR | ผลตรวจจริงระบุใน PR |
| F064-T5 | provider: `onProgress` ของ research | unit: event เป็น `searching → reading → done` และเงียบเมื่อไม่ค้น |
| F064-T6 | worker: redact + bound + throttle บนช่อง progress เดิม | worker test: ไม่มีชื่อ/ID ของสมาชิก, ≤300 ตัวอักษร, `done` อยู่ต่อหลัง tick ถัดไป |
| F064-T7 | client: บรรทัด live search + CSS | unit ของ `liveSearchLine` 4 เคส + `data-testid="draft-live-search"` |

## สไลซ์ A — เห็นสดว่า "กำลังค้นอะไร เจออะไร" (2026-10-23)

| | |
| --- | --- |
| สถานะ | `review` — draft PR [#211](https://github.com/Thanyers/tabletop/pull/211) |
| branch | `feat/F064-search-visibility` จาก `origin/dev` `0ad7278` |
| เวอร์ชัน | MINOR — เพิ่มฟิลด์ optional ใน progress ของ job ที่กำลังรัน ไม่มี migration/secret/binding |

### สัญญาที่เปลี่ยน

`ModelJobProgress` (progress ของ job ที่กำลังรัน) เพิ่มฟิลด์ optional:

```jsonc
{
  "progress": {
    "receivedChars": 0,
    "reasoningChars": 0,
    "search": { "phase": "reading", "query": "VAT ไทย 2569", "resultsCount": 4, "topTitle": "…" }, // ≤180 + ≤120 = ≤300, redacted
    "updatedAt": 1761…
  }
}
```

- `phase` เป็น `searching` → `reading` → `done`; ไม่มี event เลยเมื่อคำขอไม่ต้องค้น
- worker redact `query`/`topTitle` ด้วย `redactString` + `createIdentityReplacements` ชุดเดียวกับ F050 **ก่อน** clamp; สร้างชุดแทนไม่ได้ = ทิ้ง event (ไม่เก็บดิบ)
- ไม่ throttle event `done` และ worker แนบ event ล่าสุดไปกับทุก tick ถัดไป บรรทัด `✓ ใช้ N แหล่ง` จึงอยู่ตลอดร่าง
- `parseModelJobProgress` ตรวจขอบเขตตอนอ่าน row (query ≤180, topTitle ≤120, count ≤100)
- ไม่มีผลกับ response ที่สำเร็จ และฝั่งเก่าที่ไม่รู้จักฟิลด์นี้ก็เพิกเฉยได้

### การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | ใช้ช่อง progress เดิมของ F050 (job view + poll) | client poll job view อยู่แล้ว; เพิ่ม optional field = rollback ได้ ไม่ต้องมี transport ใหม่ |
| 2026-10-23 | worker เก็บ event ล่าสุดส่งซ้ำทุก tick | ถ้าไม่เก็บ บรรทัด "ใช้ N แหล่ง" จะหายทันทีที่ provider ส่ง progress ของการร่างถัดไป |
| 2026-10-23 | ไม่ throttle `done` | ถ้า event ปิดถูกทิ้งเพราะติดหน้าต่าง 900 ms การ์ดจะค้างที่ "กำลังค้น…" จนร่างจบ |
| 2026-10-23 | listener ที่โยน error ถูกกลืนใน provider | research ยัง best-effort: UI พังต้องไม่ทำให้ค้นหรือร่างล้ม |
| 2026-10-23 | `resultsCount` ของ `reading` = จำนวนผลที่ adapter เก็บหลังกรอง | ตรงกับสิ่งที่โมเดลเห็นและสิ่งที่ "เจอ N" ควรหมายถึง |

### ผลตรวจสไลซ์ A

Node **22.23.2** · branch `feat/F064-search-visibility`

| คำสั่ง | ผล |
| --- | --- |
| `npx vitest run server/providers/deepseek-research.test.ts src/tabletop/ui/table-chat-state.test.ts` | **35/35** — provider 8 (เพิ่ม 3: emit, เงียบเมื่อไม่ค้น, listener พัง + bound) + chat-state 27 (เพิ่ม 4: `liveSearchLine`) |
| `npm run test:cloudflare` | **159/159** (10 ไฟล์) — เพิ่ม mapping test ใน `ai.test.ts` และ worker test ใน `room.test.ts` (redact/≤300/`done` อยู่ต่อ) |
| `npm test` | **755 passed / 1 skipped** (101 ไฟล์, 1 ไฟล์ skip) |
| `npm run build` | ผ่าน (typecheck 3 config + vite) |
| `npm run lint` | 0 error / 105 warning (เท่า baseline) |
| `node scripts/check-public-files.mjs` | 0 finding |

### ความเสี่ยง / ข้อจำกัดสไลซ์ A

- **ยังไม่ยืนยันด้วย browser suite**: เทสต์ยืนยัน provider/worker/client line แล้ว แต่ยังไม่มี fixture ที่ stream event ค้นจริงผ่านเบราว์เซอร์
- **ข้อความจากผู้ให้บริการ**: query มาจากโมเดลและ title มาจากเว็บสาธารณะ → ยังต้อง redact ก่อนเก็บเหมือน thinking tail
- **ค่าใช้จ่ายต่อ tick**: job row โตขึ้น ≤300 ตัวอักษรต่อครั้งที่เขียน (ไม่เกิน 1 ครั้ง/900 ms) และถูกเขียนทับด้วยผลลัพธ์เมื่อจบ


## ผลตรวจ

Node **22.23.2** (รุ่นเดียวกับ CI) · branch `feat/F064-web-search` จาก `origin/dev` `c5c8803`

| คำสั่ง | ผล |
| --- | --- |
| `npm test` | **737 passed / 1 skipped** (738) — baseline 718 + 19 ใหม่ |
| `npm run build` | ผ่าน (typecheck 3 config + vite) |
| `npm run lint` | 0 error / 105 warning (baseline 103) |

ยิงจริงกับ API (ไม่ใช่ mock): research → draft → ตรวจ citation 4 เคส — E1 VAT ไทย (5/5 citation ผ่าน, แหล่ง `thaigov.go.th` authority 4), E2 WHO BMI (2/2), E3 ค่าคงที่ฟิสิกส์ (4/4), E4 บวกเลข (ไม่ค้น, 0 citation) — citation ที่โมเดลเขียน URL ใหม่ผ่านการ normalize ทั้งหมด

## ความเสี่ยง / ข้อจำกัด

- **หลักฐานในตารางยังไม่ใช่หลักฐานของโต๊ะ**: ผลค้นใช้ประกอบการร่างเท่านั้น ไม่ได้เข้า `program.evidence` (ต้องทำระบบ import source ก่อน) — งานถัดไป
- **ต้นทุน/เวลา**: เพิ่มได้ถึง 1 calls + 2 search ต่อการร่างหนึ่งครั้ง (วัดได้ 3–24s) ยังอยู่ในเพดาน 240s
- **คุณภาพผลค้นไทย**: ดีกับแหล่งราชการ (authority 4) แต่บาง query คืนเอกสารไม่ตรง — validator จึงต้องกรอง/ตรวจเสมอ
