# AI table generation — findings (2026-10-21)

เอกสารนี้สรุป **สิ่งที่วัดได้จริง** จากการทดลอง A → B → C + thinking probe ทั้งหมดทำนอก production (ไม่มีไฟล์ใน repo ถูกแก้) — ใช้คู่กับ [HANDOFF.md](HANDOFF.md)

- Base ที่ใช้ทดลอง: `tabletop-dev` branch `feat/F029-success-corpus` (ตอนทดลอง commit `f3792ab`; หลังจบงานมี `7c4c0f1 F030: measure corpus rounds and per-case stability` เพิ่มเข้ามา — ต้อง rebase ก่อนใช้ตัวเลข)
- Node `v22.23.2`, model `deepseek-flash` (DeepSeek-V4.1-Flash-1017), `thinking: disabled` ยกเว้น probe สุดท้าย
- Corpus: 20 เคส (10 เคส F029 เดิม + 10 ใหม่) + 1 เคสไฟล์ 10 KB
- Live runs ใช้ key จาก `.env.deploy.local` (ไม่ถูกเขียนลงไฟล์ใด ๆ) — ตรวจแล้วไม่พบ key ในผลทดลอง

## 1. Prompt ปัจจุบันกินงบไปเกือบทั้งหมด

จับ request body จริงผ่าน `DeepSeekChangeProvider` ด้วย fake `fetch` (ไม่มีเน็ต):

| องค์ประกอบ | ขนาด |
| --- | ---: |
| System prompt | **47,149 ตัวอักษร** (28 element) |
| — JSON Schema จาก zod | **35,968 (76%)** |
| — กฎ 26 ข้อ + ตัวอย่าง | 11,181 |
| — กฎที่เกี่ยวกับ canvas | 5,744 (12 จาก 27 บรรทัด) |
| Request body (โต๊ะว่าง) | **54,040 bytes** |
| System ที่ escape แล้วใน body | **53,681 bytes = 99.34% ของ body** |
| เพดาน body ที่โค้ดตั้ง | 64,000 bytes |
| แนบไฟล์ได้จริง (ไม่มี program) | **9,895 bytes** (≈3,298 ตัวอักษรไทย) |
| แนบไฟล์ได้จริง (มี program + 3 rows) | **5,017 bytes** |
| Records | ~81 bytes/row |

- Prompt เหมือนเดิมทุก attempt และถูกส่งซ้ำสูงสุด 4 รอบ; cache hit 94% ใน runs จริง
- ไฟล์หลักฐาน: `prompts/system-prompt-table-current.txt`, `prompts/prompt-anatomy.md`, `reports/prompt-budget.md`

## 2. Baseline สด (A) — 20 เคส 2 trials

| arm | matched | drafts | first-attempt | requests | cost/run | case P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current prompt | 15/20 และ 18/20 (เฉลี่ย **16.5**) | 9–12 | **29.2%** ของ draft | 40 | $0.0695 | 19.5–22.2s |

ปัญหา 23 issues (จัดหมวดใหม่จากข้อความจริง):

| หมวด | จำนวน |
| --- | ---: |
| invalid JSON | **9 (39%)** |
| scoped-record | 3 |
| unknown-record-field | 3 |
| aggregate-row-variable | 3 |
| scene-text-number / preserve-records / list-field / shadowing / unknown-scalar | 5 |

- invalid JSON เกิดใน 6 เคส; `loan-formula` พัง 4/4 รอบ
- ข้อความซ่อมตอน JSON พังมีแค่ `Return a complete JSON object, without Markdown.` ไม่มีตำแหน่ง
- 3 เคสที่ควรได้ draft แต่ **หนีไปถาม clarify** หลังซ่อมรอบแรกพัง (`dragon`, `join`, `cafe-sliders`) เพราะ prompt อนุญาตให้ถามแทนเมื่อซ่อมไม่ได้
- หลักฐาน: `reports/issue-analysis-baseline.md`

## 3. Compact schema guide (B) + live A/B

แทน JSON Schema 35,968 ตัวอักษรด้วย guide มือ 5,090 ตัวอักษร:

| | current | compact |
| --- | ---: | ---: |
| System prompt | 47,149 | **16,309** |
| Empty body | 54,040 | **17,203** |
| แนบไฟล์ได้ (1 ไฟล์) | 9,895 | **32,768** (ชนเพดานต่อไฟล์) |
| 2 ไฟล์ | 9,829 | 46,666 |
| 1 ไฟล์ + program + records | 5,017 | 32,768 |

Live A/B 2 trials/arm (corpus เดียวกัน, validator เดียวกัน):

| metric | current | compact |
| --- | ---: | ---: |
| matched เฉลี่ย | 16.5/20 | **18.5/20** |
| first-attempt share | 29.2% | **43.9%** |
| requests เฉลี่ย | 40 | 36.5 |
| cost เฉลี่ย | $0.0695 | $0.0677 |
| case P95 | 19.5 / 22.2s | 21.9 / 19.7s |

- `join` (cross-collection) ผ่าน 2/2 ใน compact แต่ 0/2 ใน current
- ยังแกว่ง: `cafe-sliders`, `water-two-seats`, `loan-formula` (คนละรอบคนละเคส)
- n=2 และ guide ที่รันจริงเป็น draft 5,041 ตัวอักษร (final 5,090) — ต้อง rerun
- หลักฐาน: `reports/live-ab-current-vs-compact.md`, `prompts/compact-schema-guide.txt`, `reports/compact-schema-report.md`

## 4. Cap probe — ไฟล์ 10 KB

| arm | outcome | requests | เวลา |
| --- | --- | ---: | ---: |
| current prompt | error `MODEL_PROVIDER_INPUT_TOO_LARGE` | **0** | 4ms |
| compact guide | error (timeout) | 2 | 25,005ms |

- compact ส่ง request ได้จริง (แก้ budget สำเร็จ) แต่ attempt 1 ใช้ 16.5s แล้ว fail (`A view relates to an unknown view.`), attempt 2 ชน deadline 25s
- **ข้อสรุป: หลังแก้ budget เพดานถัดไปคือ deadline ไม่ใช่ body cap**
- หลักฐาน: `reports/cap-probe.md`

## 5. deadline อย่างเดียวไม่พอ

รัน 3 เคสที่แกว่งด้วย deadline 45s (thinking ยังปิด): ได้ 1/3 matched (`cafe-sliders` clarify, `water` reject, `loan` draft) — การขยายเวลาโดยไม่เปลี่ยนคุณภาพโมเดลไม่ช่วย

## 6. Thinking probe — สัญญาณที่ดีที่สุด

variant: `thinking: enabled`, `max_tokens` 16,384, per-call timeout 90s, deadline 90s (6 เคสที่พังบ่อย):

| case | ผล | เวลา |
| --- | --- | ---: |
| dragon | **draft attempt 1** | 48.6s |
| join | **draft attempt 1** | 52.2s |
| chart-metric | **draft attempt 1** | 47.0s |
| water-two-seats | **draft attempt 1** | 60.4s |
| cafe-sliders | error `RESPONSE_INVALID` | 70.6s |
| loan-formula | reject 4/4 (invalid JSON) | 69.6s |

- **4/6 ผ่านตั้งแต่ attempt แรก** (baseline: join 0/3, dragon/cafe/water ต้องซ่อมหลายรอบ)
- draft ที่สำเร็จใช้ completion **10,013–13,572 tokens** (reasoning 8,425–11,458) → **เกิน 8,192 ทั้งหมด**; ถ้าใช้ cap เดิมจะถูกตัดเป็น `finish_reason="length"` → invalid JSON
- cafe-sliders น่าจะชนเพดาน 16K (หรือ finish ไม่ใช่ `stop`) — ต้องทดสอบ 32K
- loan-formula ยังพัง invalid JSON ทุก attempt → thinking ไม่ใช่ยาครอบจักรวาล; ต้องมี repair diagnostics ที่ดี
- หลักฐาน: `reports/thinking-probe.md`

## 7. JSON repair แบบ append-only ไม่พอ

ทดลอง offline กับ raw replies ที่พัง JSON 25 ไฟล์: เติม quote/วงเล็บปิดท้ายให้ → parse ผ่าน 5, ผ่าน domain validator **0** — เพราะ error อยู่กลางโครงสร้าง ไม่ใช่ขาดท้ายไฟล์
→ ต้องใช้ insert-at-error repair (มี retry bound) หรือ diagnostics ที่บอกตำแหน่ง ไม่ใช่ append-only

## 8. Two-phase (C) — ขนาด

| | chars |
| --- | ---: |
| Core schema (ไม่มี canvas) | 13,965 |
| Canvas schema | 26,768 |
| Phase 1 prototype prompt | 18,355 → body 21,442 (headroom 42,558) |
| Phase 2 prototype prompt | 29,847 → body 34,996 (headroom 29,004) |

Two-phase ไม่ใช่ทางแก้ budget อีกต่อไป (compact guide แก้ไปแล้ว) แต่ยังเป็นทางแก้ **per-view resilience + deadline** — ดู `reports/two-phase-design.md`, `prompts/phase1-core.md`, `prompts/phase2-views.md`

## 9. ข้อเท็จจริงจาก DeepSeek API docs (2026-10-21)

- `deepseek-flash` = DeepSeek-V4.1-Flash-1017 · **context 1M tokens** · **max output 384K tokens**
- `max_tokens` รับ 1–393,216; default **8K (non-thinking)** / **64K (thinking)** / 128K เมื่อ `reasoning_effort=max`
- JSON mode: ถ้า `finish_reason="length"` เนื้อหาอาจถูกตัดกลาง → JSON พัง
- ที่มา: <https://api-docs.deepseek.com/api/create-chat-completion>, <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>

## 10. ข้อจำกัดของข้อสรุป

- Live A/B n=2 ต่อ arm; โมเดล non-deterministic — ตัวเลข matched/first-attempt มี variance
- Thinking probe n=1 และใช้ 16K/90s; ยังไม่ได้ทดสอบ 32K/120s
- ยังไม่มีการ activate table หรือเรียก billing endpoint ในการทดลอง (validator เท่านั้น)
- Corpus เป็น synthetic; ยังไม่มี hidden set
- ราคาใน `billing.ts` เป็น USD ($0.30/$1.20) แต่ docs เป็น CNY — ต้องตรวจก่อนใช้ตัดสินใจเรื่องต้นทุน
- หลังทดลองมี commit F030 เพิ่ม — ต้อง rebase และรัน corpus ซ้ำบน base ใหม่
