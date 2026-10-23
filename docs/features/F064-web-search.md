# F064 — ค้นเว็บเองเมื่อโจทย์ต้องใช้ข้อเท็จจริงภายนอก

| | |
| --- | --- |
| สถานะ | `review` — T1–T4 merge (#207) · สไลซ์ A merge (#211) · สไลซ์ B merge (#214) · สไลซ์ C ลงโค้ดแล้ว (branch `feat/F064-web-evidence`) |
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

**ไม่รวม:** ให้ผลค้นเว็บกลายเป็น `program.evidence` (evidence ต้องอ้าง source ที่มีในโต๊ะ — ออกแบบไว้แล้วที่ [สไลซ์ C](F064-slice-c-web-evidence.md) แต่ยังไม่ลงโค้ด) · เปิด tool calling ในสตรีมร่างหลัก (research เป็นขั้นก่อนร่าง) · การแก้ไข/ลบแหล่งที่แสดงบนการ์ด (สไลซ์ B แสดงอย่างเดียว)

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
| F064-T8 | worker: เก็บ/redact/bound research metadata ต่อ job + ส่งใน job view | worker test: view มีเฉพาะแหล่ง http(s) ที่ redact แล้ว, ไม่มี key เมื่อไม่ค้น |
| F064-T9 | client: `<details>Sources (N)</details>` + ลิงก์/วันที่/authority | unit ของ `draftSources` 4 เคส + `data-testid="draft-sources"` |

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
| `npm run test:cloudflare` | **160/160** (10 ไฟล์) — เพิ่ม mapping test ใน `ai.test.ts` และ worker test ใน `room.test.ts` (redact/≤300/`done` อยู่ต่อ) |
| `npm test` | **760 passed / 1 skipped** (102 ไฟล์, 1 ไฟล์ skip) |
| `npm run build` | ผ่าน (typecheck 3 config + vite) |
| `npm run lint` | 0 error / 105 warning (เท่า baseline) |
| `node scripts/check-public-files.mjs` | 0 finding |

**ui-gate บน harness ที่ใช้ `table-chat.css` + tokens จริง** (`test-results/f064-search-line-harness.html`): **15/16 measured checks ผ่าน** · overflow 280/320/414 = 0 · contrast (light/dark), axe, touch targets, clipped content, mobile-first, RTL ผ่าน — เหลือ FAIL เดียวคือ "No emoji in UI output" เพราะอักขระ `🔎`/`✓` เป็น copy ที่ handoff กำหนด; DTCG token pairs = SKIP (โปรเจกต์ใช้ CSS tokens ไม่ใช่ไฟล์ DTCG) · ภาพ: `docs/previews/f064-search-line-{320,414}.jpg`

### ความเสี่ยง / ข้อจำกัดสไลซ์ A

- **ยังไม่ยืนยันด้วย browser suite แบบ end-to-end**: provider, worker และ client line มี unit/worker test ครบ และมี harness render จริงแล้ว แต่ยังไม่มี fixture ที่ stream event ค้นผ่านเบราว์เซอร์ทั้งเส้น
- **การ์ดแคบมาก (320px)**: แก้แล้วใน follow-up 2026-10-23 — บรรทัดแยกเป็น span, ellipsis เฉพาะ query และ `· เจอ N` ถูกตรึงไว้ (`flex: none`) จึงเห็น count เสมอ
- **ข้อความจากผู้ให้บริการ**: query มาจากโมเดลและ title มาจากเว็บสาธารณะ → redact ก่อนเก็บเหมือน thinking tail
- **ค่าใช้จ่ายต่อ tick**: job row โตขึ้น ≤300 ตัวอักษรต่อครั้งที่เขียน (ไม่เกิน 1 ครั้ง/900 ms) และถูกเขียนทับด้วยผลลัพธ์เมื่อจบ
- **F050 ได้รับการแก้แบบเดียวกันแล้ว** ใน follow-up นี้: `.tt-chat-card__thinking` มี `justify-self: stretch` — บรรทัด thinking ที่ยาวจะไม่ดันการ์ดอีก

### Follow-up 2026-10-23 (branch `fix/F064-followups`)

| เรื่อง | สิ่งที่แก้ |
| --- | --- |
| `· เจอ N` ถูกตัดที่ 320px | `liveSearchParts()` แยก `{icon, text, query, found}`; JSX แยก span `.tt-chat-card__search-query` (ellipsis) กับ `.tt-chat-card__search-count` (`flex: none`) — `liveSearchLine()` ยังคืนสตริงเดิมเพื่อ test/a11y |
| F050 latent overflow | `.tt-chat-card__thinking { justify-self: stretch; }` — grid item ที่ถูก `justify-items:center` ไม่ถูกจัดขนาดตาม nowrap content |
| browser fixture นับ provider call เกิน | dev แก้ `TABLE_WEB_SEARCH: 'off'` ใน `tests/*-browser.mjs` แล้ว (มาจาก F066); follow-up เติมให้ `scripts/{generic-table-local,canvas-evolution-local}.mjs` ในโหมด synthetic เท่านั้น (โหมด `--real-ai` ยังเปิด research) |

ผลตรวจ (Node 22.23.2): unit **819 passed / 5 skipped** (113 ไฟล์), `test:cloudflare` **170/170**, `build` ผ่าน, `lint` 0 error / 107 warning, public scan 0 finding, ui-gate harness **15/16** (เหลือ "No emoji" ตาม copy `🔎`/`✓` ที่ handoff กำหนด) · เพิ่ม unit 2 เคสของ `liveSearchParts` และอัปเดตภาพ `docs/previews/f064-search-line-{320,414}.jpg` ให้เห็น count ครบที่การ์ดแคบ


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

## สไลซ์ B — เห็น "ค้นอะไร เจอที่ไหน" บนการ์ดร่าง (2026-10-23)

| | |
| --- | --- |
| สถานะ | `review` — draft PR [#214](https://github.com/Thanyers/tabletop/pull/214) |
| branch | `feat/F064-sources-card` จาก `origin/dev` `d768927` |
| เวอร์ชัน | MINOR — เพิ่มฟิลด์ optional ใน job view ที่จบแล้ว ไม่มี migration/secret/binding |

### สิ่งที่ผู้ใช้เห็น

การ์ดร่างที่จบแล้วมี `<details>Sources (N)</details>` — กางออกเห็นไตเติลเป็นลิงก์จริง (เปิดแท็บใหม่), วันที่ประกาศ และ authority 0–4 ต่อแหล่ง; draft ที่ไม่ค้นไม่มีบล็อกนี้

### สัญญาที่เปลี่ยน

job view ของ draft ที่จบแล้ว (`GET /api/workspaces/:id/model/:jobId`) เพิ่มฟิลด์ optional:

```jsonc
{
  "status": "completed",
  "candidateId": "…",
  "research": {
    "queries": ["VAT ไทย 2569"],
    "sources": [
      { "title": "ประกาศอัตรา VAT", "url": "https://www.thaigov.go.th/…", "date": "2026-07-26T16:00:00+00:00", "authority": 4 }
    ]
  }
}
```

- ≤6 แหล่ง, ≤4 queries; `title` ≤200, `url` ≤500, `date` ≤40 ตัวอักษร, `authority` 0–4
- `url` ต้องผ่าน `safeExternalUrl()` ทั้งตอนเก็บและตอนอ่าน: http/https เท่านั้น, host ต้องมีจุด, ห้ามมี username/password ⇒ `javascript:` / `data:` ถูกทิ้ง
- worker redact `title`/`url`/`queries` ด้วย `redactString` + `createIdentityReplacements` ชุดเดียวกับ F050 **ก่อน** clamp; สร้างชุดแทนตัวตนไม่ได้ = ไม่เก็บ research เลย
- เก็บครั้งเดียวตอนจบ job (clarification หรือ commit) ไม่ได้เขียนทุก progress tick
- `parseModelJobResearch()` ตรวจซ้ำตอนอ่าน row · draft ที่ไม่ค้นและ draft ที่ล้มไม่มีฟิลด์นี้
- ไม่มีทางเข้า `program.evidence`; response ของคำสั่งอื่นไม่เปลี่ยน

### การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | เก็บ research metadata ตอนจบ job ไม่ใช่ทุก tick | รายการแหล่งไม่เปลี่ยนระหว่างร่าง และไม่ทำให้ job row โตทุก 900 ms |
| 2026-10-23 | แสดงบนการ์ดร่างที่จบแล้วเท่านั้น | ระหว่างรอมีบรรทัด live search อยู่แล้ว; รายการเต็มมีประโยชน์ตอน review |
| 2026-10-23 | ตรวจ URL ทั้งตอนเก็บและตอนอ่าน | `model_jobs.data` เป็น JSON อิสระ — ฝั่งอ่านต้องไม่เชื่อถือ row เก่าหรือถูกแก้ |
| 2026-10-23 | ไม่ส่ง brief/summary ขึ้นการ์ด | ข้อความยาวจาก provider ไม่ใช่สิ่งที่ผู้ใช้ขอ และเพิ่มพื้นที่รั่วข้อมูลโดยไม่จำเป็น |
| 2026-10-23 | web sources ยังไม่เข้า `program.evidence` | ต้องมีขั้น import + ยืนยัน `verified` ก่อน (สไลซ์ C) |

### ผลตรวจสไลซ์ B

Node **22.23.2** · branch `feat/F064-sources-card`

| คำสั่ง | ผล |
| --- | --- |
| `npx vitest run src/tabletop/ui/table-chat-state.test.ts` | **31/31** — เพิ่ม 4 เคสของ `draftSources`/`formatSourceDate` |
| `npm run test:cloudflare` | **164/164** (10 ไฟล์) — เพิ่ม mapping test ใน `ai.test.ts` และ worker test 2 เคส (view ที่ redact/ตัด `javascript:`/ไม่มี key เมื่อไม่ค้น) |
| `npm test` | **770 passed / 1 skipped** |
| `npm run build` | ผ่าน |
| `npm run lint` | 0 error / 106 warning |
| `node scripts/check-public-files.mjs` | 0 finding |

**ui-gate บน harness ที่ใช้ `table-chat.css` + tokens จริง** (`test-results/f064-sources-harness.html`, collapsed + open): **16/16 measured checks ผ่าน** · overflow 280/320/414 = 0, contrast (light/dark), axe, touch targets, clipped/overlap, mobile-first, RTL ผ่าน · SKIP = DTCG token pairs (โปรเจกต์ใช้ CSS tokens ไม่ใช่ DTCG) + focus trap (ไม่มี dialog) · ภาพ: `docs/previews/f064-sources-{320,414}.jpg`

**บั๊กที่เจอจาก gate และแก้แล้ว:** `display: grid` บน `<ul>` ภายใน `<details>` เป็น author rule ที่ทับ UA rule ที่ซ่อนเนื้อหาเมื่อยังไม่กาง ⇒ รายการโผล่ตลอดแม้ collapsed (เจอเป็น overlap 59% กับปุ่ม Review rules) แก้เป็นซ่อน explicit + `[open] > ul { display: grid }`

### ความเสี่ยง / ข้อจำกัดสไลซ์ B

- **ยังไม่ยืนยันด้วย browser suite แบบ end-to-end**: unit/worker + harness render จริง (16/16) ครบ แต่ยังไม่มี fixture ที่ stream research ผ่านเบราว์เซอร์ทั้งเส้น
- **authority/date ไม่ได้ตรวจเนื้อหา**: เป็นค่าที่ผู้ให้บริการรายงาน ใช้บอกคุณภาพแหล่งเท่านั้น
- **แหล่งที่แสดงไม่ใช่หลักฐานของโต๊ะ**: ยังอ้างใน `program.evidence` ไม่ได้และลบ/แก้ไม่ได้ในสไลซ์นี้
- **ขนาด job row**: โตขึ้นไม่เกิน 6 แหล่ง (ไม่กี่ KB) ครั้งเดียวตอนจบ และถูกเขียนทับเมื่อ job ถูกเก็บกวาดตามรอบเดิม

## สไลซ์ C — ผลค้นเป็นหลักฐานของโต๊ะ (ลงโค้ดแล้ว 2026-10-23)

เอกสารออกแบบ/ทางเลือก/ความเสี่ยง: [F064-slice-c-web-evidence.md](F064-slice-c-web-evidence.md) · สรุปที่ลงจริง:

### สิ่งที่ผู้ใช้เห็น

1. การ์ดร่างที่ใช้ research มีปุ่ม **Add to table sources** (คนที่มี `files.add`) — เพิ่มแหล่งที่ร่างนั้นใช้เป็น source ของโต๊ะ
2. source ใหม่เป็นสถานะ **Provided** บนการ์ด Files พร้อมไตเติล/ลิงก์/วันที่/authority; **owner** เห็นปุ่ม **Verify / Reject**
3. **Verified** เท่านั้นที่ถูกส่งให้ AI ในคำขอถัดไปและอ้างใน `program.evidence` ได้; Provided/Rejected ไม่ถึงโมเดลและอ้างไม่ได้
4. source ที่ Rejected ยังอยู่บนโต๊ะ (เห็นป้าย Rejected) และลบได้ด้วยคำสั่งเดิมถ้าไม่มี revision อ้าง

### สัญญาที่เปลี่ยน

- `TableSource` เพิ่ม optional `origin:'web'`, `status:'provided'|'verified'|'rejected'`, `url`, `publishedAt`, `authority` — ไฟล์ที่ import เดิมไม่มีฟิลด์เหล่านี้และทำงานเหมือนเดิม
- `text` ของ web source = `title + "\n" + summary` (≤200 + ≤800) ⇒ กติกา evidence เดิม `text.includes(quote)` บังคับ quote ให้มาจากไตเติล/summary ไม่ใช่ URL
- คำสั่งใหม่: `table.addWebSources { sources }` (`files.add`, worker redact `title/url/summary` ก่อน, dedupe ด้วย URL, เพดานเดิม 4 แหล่ง/32 KiB/64 KiB) และ `table.reviewWebSource { sourceId, status }` (owner, first review only)
- กติกา evidence: ไม่มี source ที่ cite ได้ (ไฟล์ หรือ web ที่ verified) ⇒ evidence ต้องว่าง; มี ⇒ ต้องมีอย่างน้อย 1 และ quote ต้องอยู่ใน `source.text` + web source ต้อง verified
- `tableDraftInput` กรอง web source ที่ไม่ใช่ verified ออก; system prompt เปลี่ยนเป็น "cite only exact quotes from a supplied source text" (ยังใต้ 20,500 ตัวอักษร)
- capability `webEvidence` (Worker true เว้นแต่ `TABLE_WEB_EVIDENCE=off`) คุมการแสดงปุ่ม; คำสั่งถูกปฏิเสธเมื่อ switch off; event log เก็บเฉพาะ `sourceId/filename/sha256`

### การตัดสินใจ (เจ้าของผลิตภัณฑ์ยืนยัน 2026-10-23)

| เรื่อง | ค่าที่ใช้ |
| --- | --- |
| ใคร verify ได้ | **owner เท่านั้น** (ตามแบบ invoice `reviewSource`) |
| เพดาน source | **4 แหล่งเดิม** (ไฟล์ + web รวมกัน) |
| source ที่ reject | **เก็บไว้ให้เห็น** แต่ตัดจาก AI input และอ้างไม่ได้ |
| ร่างเดิมหลัง verify | **ต้องขอร่างใหม่** — ร่างก่อน verify ไม่ถูกแก้ย้อนหลัง |

### ผลตรวจสไลซ์ C

Node **22.23.2** · branch `feat/F064-web-evidence`

| คำสั่ง | ผล |
| --- | --- |
| `npx vitest run src/tabletop/domain/table-web-sources.test.ts src/tabletop/shared/table-draft-input.test.ts` | **12/12** (domain 6 + draft input 6) |
| `npm run test:cloudflare` | **182/182** (13 ไฟล์) — `web-evidence.test.ts` 4 เคส + room test 1 เคส (redact, event ไม่มีข้อความ) |
| `npm test` | **864 passed / 5 skipped** (120 ไฟล์) |
| `npm run build` | ผ่าน |
| `npm run lint` | 0 error / 111 warning (ไม่มี warning ใหม่ในไฟล์ที่แตะ) |
| `node scripts/check-public-files.mjs` | 0 finding |
| `ui-gate` บน harness (Files card + draft CTA, 375/900) | **15/16** — overflow 280/320/414 = 0, state-aware WCAG, touch targets, clipped content, mobile-first, RTL ผ่าน; เหลือ axe color-contrast 3 node ที่เป็นข้อความ muted เดิมของ `tabletop.css` ไม่ใช่ element ใหม่ (badge/ปุ่มวัดได้ 5.43–5.94:1) |

ภาพ: `docs/previews/f064-web-evidence-{375,900}.jpg`

### ความเสี่ยง / ข้อจำกัดสไลซ์ C

- **ไม่มี auto-verify**: แหล่งใหม่ต้องมี owner กดทุกครั้ง; draft ที่ยังไม่ verify จะไม่มี citation จากเว็บ
- **first review only**: verified → rejected ไม่ได้ (กันหลักฐานหาย); ถ้าต้องถอนต้องลบ source ซึ่งติด guard เดิมเมื่อ revision อ้าง
- **ไม่มี expiry**: เก็บ snapshot ณ วันค้น ไม่ตามเว็บจริง
- **ยังไม่รัน browser flow end-to-end** (add → verify → cite): ครอบด้วย domain/worker/unit + render harness
- **Node guest runtime ไม่เปิด `webEvidence`**: ปุ่มซ่อน (Worker เท่านั้น)
