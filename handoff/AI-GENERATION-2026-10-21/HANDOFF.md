# HANDOFF — ทำให้ AI table generation "ใช้ได้ก่อน" (thinking + caps + deadline)

**วันที่:** 2026-10-21 · **สถานะ:** ยังไม่มีการแก้ production code · **Finding:** [FINDINGS.md](FINDINGS.md)
**กล่องนี้มี:** finding, prompt ปัจจุบัน, prompt ที่เสนอ, รายงานการทดลอง — พอสำหรับเริ่มงานใน session ใหม่โดยไม่ต้องรัน experiment ซ้ำ

> อ่าน [`AGENTS.md`](../../AGENTS.md) ก่อนแตะโค้ด · งานนี้เป็น **MINOR** (ไม่มี migration/schema)

## 0. สรุปสิ่งที่ต้องทำ

เปลี่ยนจาก "single call, thinking off, 8K output, 25s" เป็น:

1. **thinking enabled** + `max_tokens` 32K–64K
2. ขยาย response/output caps ให้รองรับ thinking (reasoning tokens นับใน `completion_tokens`)
3. **deadline 120s** (จาก 25s) และขยับ job-interrupted threshold
4. จัดการ `finish_reason="length"` เป็น repairable issue
5. ใช้ **compact schema guide** แทน JSON Schema 36 KB (แก้ input cap)
6. เพิ่ม parse diagnostics (ตำแหน่ง + excerpt) ใน repair turn
7. รัน corpus 20–30 เคส × 2–3 trials แล้วเทียบกับ baseline

เหตุผลเชิงตัวเลขอยู่ใน [FINDINGS.md](FINDINGS.md): thinking ทำให้ 4/6 เคสยากผ่านตั้งแต่ attempt แรก แต่ใช้ 47–60s/ครั้ง และ output 10–13.6K tokens (เกิน cap 8,192 เดิม)

## 1. สถานะ base ก่อนเริ่ม

- ตอนเขียน handoff: branch `feat/F029-success-corpus` มี commit `7c4c0f1 F030: measure corpus rounds and per-case stability` ต่อจาก `f3792ab` (F029)
- **ต้อง rebase/แตก branch จาก `origin/dev` ล่าสุด** และตรวจ `PLAN.md` ว่า F030 ถูกใช้แล้วหรือยัง — งานนี้ควรเป็น **F031** (ถ้า F030 ยัง `doing` ให้เช็คก่อน)
- ตัวเลข experiment ทั้งหมดรันบน base ก่อน F030 — rerun บน base ใหม่ก่อนสรุปผล

## 2. การแก้โค้ด (เรียงตามลำดับ)

### 2.1 Provider — `server/providers/deepseek-changes.ts`

| ค่าคงที่ | ปัจจุบัน | ใหม่ | หมายเหตุ |
| --- | ---: | ---: | --- |
| `thinking` ใน request body (บรรทัด ~375) | `{ type: 'disabled' }` | `{ type: 'enabled' }` | ควรมี flag/env เผื่อปิด |
| `MAX_TABLE_OUTPUT_TOKENS` (~25) | 8,192 | **32,768** | reasoning + JSON ต้องพอ |
| `MAX_OUTPUT_CHARS` (~22) | 64,000 | **256,000** | รองรับ 32K tokens |
| `MAX_RESPONSE_BYTES` (~21) | 128,000 | **1,048,576** | provider response ใหญ่ขึ้น |
| `MAX_TIMEOUT_MS` (~26) | 60,000 | **120,000** | per-call; ต้อง ≥ deadline |
| `MAX_CHANGE_REQUEST_BYTES` (~14) | 64,000 | คงไว้ 64,000 **ถ้าใช้ compact guide** | ถ้าไม่ใช้ guide ให้ขยายเป็น 96,000–128,000 พร้อมแก้ token proxy |

**finish_reason="length" → repairable** (ปัจจุบันบรรทัด ~456 บังคับ `finish_reason === 'stop'` ทั้งหมด ทำให้ truncation กลายเป็น `MODEL_PROVIDER_RESPONSE_INVALID`):

```ts
const choice = raw.choices[0];
if (!isObject(choice) || !isObject(choice.message)
  || choice.message.role !== 'assistant' || typeof choice.message.content !== 'string'
  || choice.message.tool_calls !== undefined) {
  throw fail('MODEL_PROVIDER_RESPONSE_INVALID');
}
const usage = parseUsage(raw.usage);
if (choice.finish_reason === 'length') {
  throw new RejectedChangeReply(usage, [
    'The reply was truncated at the max_tokens limit. Return a smaller complete JSON object; omit views that are not essential.',
  ], choice.message.content.slice(0, 18_000));
}
if (choice.finish_reason !== 'stop') throw fail('MODEL_PROVIDER_RESPONSE_INVALID');
```

**parse diagnostics** — แทนข้อความ `Return a complete JSON object, without Markdown.` (บรรทัด ~286):

```ts
try { output = JSON.parse(content) as unknown; }
catch (error) {
  const match = /(?:position|at)\s+(\d+)/i.exec(String((error as Error)?.message ?? ''));
  const position = match ? Number(match[1]) : -1;
  const excerpt = position >= 0
    ? content.slice(Math.max(0, position - 160), position + 160)
    : content.slice(0, 320);
  throw new RejectedChangeReply(usage, [
    `Invalid JSON${position >= 0 ? ` at character ${position}` : ''}. Return one complete JSON object with balanced brackets; do not add Markdown. Context: ${excerpt}`,
  ], content.slice(0, 18_000));
}
```

ข้อควรระวัง: `content` คือ output ของโมเดลเอง — excerpt ไม่ได้เปิดเผยอะไรเกิน `previousOutput` ที่ส่งอยู่แล้ว แต่ให้จำกัด ≤400 ตัวอักษร

### 2.2 Worker loop — `cloudflare/ai.ts`

- `deadline = Date.now() + 25_000` (~505) → **120_000**
- `MAX_ATTEMPTS = 4` (~506): คงไว้ 4 หรือลดเป็น 3 (thinking ให้ first attempt ดีขึ้น) — ตัดสินด้วยตัวเลข
- `MAX_PROVIDER_INPUT_TOKENS = 65_000` (~20): ถ้าใช้ compact guide คงไว้; ถ้าขยาย body cap ต้องขยายค่านี้และแก้ proxy
- ตรวจว่า `remaining` ที่ใช้เป็น `timeoutMs` ของ provider ไม่เกิน `MAX_TIMEOUT_MS` ใหม่

### 2.3 Billing — `cloudflare/billing.ts`

- `MAX_OUTPUT_TOKENS = 8_192` (~7) → **32_768** (ให้ตรงกับ provider)
- `priceMicroUsd` (~92) คิด reservation จาก `maxOutputTokens`; 32K output จะ reserve ~4× เดิม — ตรวจ budget env (`AI_DAILY_BUDGET_MICRO_USD`, `AI_MONTHLY_BUDGET_MICRO_USD`) ว่ายังพอ
- **ราคาในโค้ดเป็น USD ($0.30/M input, $1.20/M output) แต่ docs เป็น CNY** — ตรวจก่อนสรุปเรื่องต้นทุน

### 2.4 Room / job lifecycle — `cloudflare/room.ts`

- `MODEL_JOB_INTERRUPTED` ใช้ 120s (~42) → ต้อง **มากกว่า deadline ใหม่** เช่น 180–240s ไม่อย่างนั้น job ที่ยังทำงาน會被ตีเป็น interrupted
- body cap 256 KiB (~32/549) ยังพอ
- ตรวจ `waitUntil` ของ Cloudflare ว่าอนุญาตงานยาว 120–180s ใน plan ที่ใช้ (Workers CPU limit vs wall clock)

### 2.5 Prompt — ใช้ compact guide

- ไฟล์พร้อมใช้: [`prompts/compact-schema-guide.txt`](prompts/compact-schema-guide.txt) (5,090 ตัวอักษร)
- แทน `const TABLE_CHANGE_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(tableChangeSchema));`
  ด้วยการอ่านไฟล์/const ของ guide (หรือ inline string)
- ปรับประโยค `Return exactly one JSON object conforming to this JSON Schema` → `...this compact schema guide` (ดูตัวอย่างใน `experiments/variants/provider-compact.ts`)
- **ข้อจำกัด:** guide เป็น prompt artifact ไม่ใช่ validator — zod ยังเป็น authoritative; ต้อง rerun A/B ด้วยข้อความ final ก่อน adopt
- ทางเลือกเสริม: **conditional canvas** — ใส่ canvas rules/schema เฉพาะเมื่อคำขอเกี่ยวกับภาพ/กราฟ/simulation (ประหยัดอีก ~27K chars สำหรับโต๊ะข้อมูล)
- **clarify escape:** prompt อนุญาตให้ถามแทนเมื่อซ่อมไม่ได้ → จำกัดให้ถามได้เฉพาะ attempt 1 (ไม่มี repair) หรือเมื่อเจอข้อจำกัด DSL จริง; อย่าให้ repairable error กลายเป็นคำถามผู้ใช้

### 2.6 UI / client

- Generation อาจใช้ 60–120s: ตรวจ `useTableChat`, `TableChat`, polling และข้อความระหว่างรอ; ต้องไม่ timeout ก่อน server
- แสดงสถานะ "กำลังสร้าง (อาจถึง 2 นาที)" และปุ่มยกเลิกถ้ามีอยู่แล้ว
- ตรวจ reduced-motion/spinner เดิม (F011) ยังทำงาน

## 3. Prompt ที่ต้องใช้

| ไฟล์ | คืออะไร | ขนาด |
| --- | --- | ---: |
| [`prompts/system-prompt-table-current.txt`](prompts/system-prompt-table-current.txt) | prompt ที่ production ส่งจริงวันนี้ | 47,149 chars |
| [`prompts/prompt-anatomy.md`](prompts/prompt-anatomy.md) | แยก 28 element + ขนาด + บรรทัดต้นทาง | — |
| [`prompts/compact-schema-guide.txt`](prompts/compact-schema-guide.txt) | **prompt ที่เสนอ** แทน JSON Schema | 5,090 chars |
| [`prompts/phase1-core.md`](prompts/phase1-core.md) | prototype two-phase: core program | ~4.6 KB |
| [`prompts/phase2-views.md`](prompts/phase2-views.md) | prototype two-phase: views | ~3.3 KB |

- Prompt ปัจจุบันเหมือนเดิมทุก attempt; schema generate จาก zod — ถ้าแก้ `tableChangeSchema` ต้อง regenerate/อัปเดต guide ด้วย
- Two-phase **ยังไม่ต้องทำในรอบนี้** — เก็บไว้เมื่อ compact guide + thinking ไม่พอต่อ per-view resilience/deadline

## 4. การทดสอบที่ต้องเพิ่ม

**Unit (vitest)**
- request body มี `thinking: { type: 'enabled' }`, `max_tokens: 32768`
- `finish_reason: 'length'` → `RejectedChangeReply` ที่มี issue เรื่อง truncation (ไม่ใช่ `RESPONSE_INVALID`)
- invalid JSON → issue มีตำแหน่ง/excerpt และ ≤400 ตัวอักษร
- constructor รับ `timeoutMs` ถึง 120,000 และปฏิเสธ > 120,000
- billing: reserve ด้วย max output 32,768; duplicate/uncertain ยังถูก
- room: job ที่ใช้เวลา >120s ไม่ถูกตีเป็น interrupted ก่อน deadline

**Corpus / live**
- รัน corpus 20–30 เคส × 2–3 trials ด้วย config ใหม่
- เกณฑ์ผ่าน (blocking): matched ≥18/20 (หรือ ≥85%), first-attempt ≥50% ของ draft, 0 เคสพังเพราะ `finish_reason=length`, 0 `MODEL_PROVIDER_TIMEOUT` ใน corpus, เคสไฟล์ 10 KB ต้องได้ draft/clarify
- เกณฑ์ไม่ถอย: clarify 6/6 เคสยังถามถูกภาษา, injection ไม่รั่ว, preserve rows/fields/turn ยังผ่าน
- เก็บ latency P50/P95, token, cost (ยังไม่ block แต่ต้องรายงาน)

**Browser**
- สถานะรอ AI นาน 60–120s, ไม่มี client timeout, polling ยังทำงาน, reduced motion

## 5. วิธีรัน experiment ที่มีอยู่

ใช้จาก cwd `D:\Project\project-procedural\tabletop-dev`:

```powershell
# key อยู่ใน .env.deploy.local (ห้ามเขียนลงไฟล์/รายงาน)
$line = Get-Content 'D:\Project\project-procedural\.env.deploy.local' -Encoding UTF8 |
  Where-Object { $_ -match '^DEEPSEEK_KEY=' } | Select-Object -First 1
$env:DEEPSEEK_KEY = $line.Substring('DEEPSEEK_KEY='.Length)

# 1) dry run (ไม่มีเน็ต) — วัด body size
node --import tsx D:\Project\project-procedural\experiments\eval\run.mjs --dry

# 2) live baseline ปัจจุบัน
node --import tsx D:\Project\project-procedural\experiments\eval\run.mjs --live --yes --max-requests 60

# 3) variant thinking (มีอยู่ แต่ยังเป็น 16K/90s — ต้อง rebuild ก่อน)
node D:\Project\project-procedural\experiments\variants\build-thinking-provider.mjs
$env:EVAL_PROVIDER_MODULE='file:///D:/Project/project-procedural/experiments/variants/provider-thinking.ts'
$env:EVAL_DEADLINE_MS='120000'
node --import tsx D:\Project\project-procedural\experiments\eval\run.mjs --live --yes --max-requests 80
```

- `experiments/variants/build-thinking-provider.mjs` ถูกอัปเดตเป็น **32K / 120s / finish_reason length handling แล้ว แต่ยังไม่ได้รัน** — รันแล้วเก็บผลก่อนสรุป
- `experiments/variants/provider-compact.ts` คือ variant compact guide (5,041 draft) — ต้อง rebuild จาก guide final 5,090
- Corpus: `experiments/eval/golden/cases.json` (20 + cap probe); รายงานออกที่ `experiments/eval/out/`
- ต้นทุนประมาณ: thinking 9 requests = $0.081; full corpus 20–30 เคส ≈ $0.3–0.6 และเวลา 15–30 นาที

## 6. ลำดับงานที่แนะนำ (session ใหม่)

1. `git fetch origin && git switch -c feat/F031-thinking-generation origin/dev` แล้ว rebase งาน F029/F030 ถ้าจำเป็น
2. จองงานใน `PLAN.md` (แถวใหม่ F031, สถานะ `doing`) + เปิด **draft PR** ตาม AGENTS.md
3. แก้ 2.1–2.4 (provider, ai, billing, room) + unit tests
4. เปลี่ยน prompt เป็น compact guide + ปรับ clarify escape (2.5)
5. รัน `npm test`, `npm run test:cloudflare`, `npm run lint`, `npm run build`, `npm run build:cloudflare`
6. รัน live corpus 2–3 trials ด้วย config ใหม่ เทียบกับ baseline ใน `reports/live-ab-current-vs-compact.md`
7. ปรับ UI/ข้อความรอ (2.6) + browser test
8. อัปเดต `spec.md`, `CHANGELOG.md`, feature doc ใหม่ `docs/features/F031-*.md`
9. ส่ง review — **ห้าม merge/deploy เอง** ตาม AGENTS.md §8

## 7. ความเสี่ยง / คำถามเปิด

- **ต้นทุน**: thinking เพิ่ม ~3× ต่อ draft ที่สำเร็จ; ยังไม่ block แต่ต้องมีเพดาน budget
- **Latency UX**: 60–120s ต้องมีสถานะรอที่ชัดและ retry/cancel; ตรวจ Cloudflare plan limit
- **Thinking + JSON mode**: docs เตือน truncation; เราจัดการ `length` แล้ว แต่ต้องทดสอบจริงว่า JSON ยังครบ
- **Compact guide เป็น lossy**: ต้อง A/B ด้วยข้อความ final และดู view quality ไม่ใช่แค่ schema ผ่าน
- **n=2**: ตัวเลข A/B ยังไม่พอตัดสิน; ต้อง 3 trials ขึ้นไปและรันซ้ำวันอื่น
- **F030 base ใหม่**: ต้อง rerun corpus บน base หลัง rebase
- **ราคา USD vs CNY** ใน billing.ts ไม่ตรง docs — ตรวจก่อนใช้ตัดสินใจต้นทุน
- **Two-phase** ยังไม่ทำ; ถ้า thinking+compact ไม่พอเรื่อง view/deadline ค่อยยกมา

## 8. Checklist ก่อนจบงาน

- [ ] มี branch + draft PR + แถว PLAN.md (F031)
- [ ] thinking enabled และ `max_tokens` ≥32K ถูกส่งจริง (assert ใน unit test)
- [ ] `finish_reason="length"` ได้ issue ที่ซ่อมได้ ไม่ใช่ RESPONSE_INVALID
- [ ] deadline 120s และ job-interrupted > deadline
- [ ] compact guide final 5,090 ถูกใช้ และ A/B 2–3 trials ผ่านเกณฑ์
- [ ] 10 KB source case ได้ draft/clarify
- [ ] clarify 6/6, injection, preserve ยังผ่าน
- [ ] `npm test` / `test:cloudflare` / `lint` / `build` / `build:cloudflare` ผ่าน (ระบุ Node 22.23.2)
- [ ] `spec.md` + `CHANGELOG.md` + feature doc อัปเดต
- [ ] ไม่มี secret/ข้อมูลผู้ใช้ในไฟล์ที่ track (repo public)
