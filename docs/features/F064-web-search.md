# F064 — ค้นเว็บเองเมื่อโจทย์ต้องใช้ข้อเท็จจริงภายนอก

| | |
| --- | --- |
| สถานะ | `review` — ยังไม่ merge/deploy |
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
