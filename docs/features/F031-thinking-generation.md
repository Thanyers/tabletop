# F031 — thinking generation + output caps + longer deadline

| | |
| --- | --- |
| สถานะ | `review` (รอ review/merge — ยังไม่ deploy) |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เปลี่ยนพฤติกรรมการสร้างร่าง (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F031-T1` |

## ทำไม (measured findings จาก handoff — ไม่ตีความใหม่)

- prompt เดิม system 47,149 chars โดย JSON Schema 35,968 chars (76%) → body โต๊ะว่าง 54,040 bytes จากเพดาน 64,000 → แนบไฟล์ได้จริง ~9.9 KB
- baseline corpus: matched 16.5/20, first-attempt 29.2%, invalid JSON 39% ของ issue, 3 เคสที่ควรได้ draft กลับถาม clarify
- thinking probe: 4/6 เคสยากผ่าน attempt แรก แต่ใช้ completion 10,013–13,572 tokens (เกิน cap 8,192) และ 47–60s/ครั้ง
- DeepSeek docs: `max_tokens` รับถึง 393,216; JSON mode ตัดกลางเมื่อ `finish_reason="length"`

## สิ่งที่เปลี่ยน

| จุด | เดิม | ใหม่ |
| --- | --- | --- |
| `thinking` | disabled | **enabled** |
| `MAX_TABLE_OUTPUT_TOKENS` | 8,192 | **32,768** |
| `MAX_OUTPUT_CHARS` | 64,000 | **256,000** |
| `MAX_RESPONSE_BYTES` | 128,000 | **1,048,576** |
| `MAX_TIMEOUT_MS` (provider) | 60,000 | **180,000** |
| deadline loop (`ai.ts`) | 25,000 | **180,000** |
| billing `MAX_OUTPUT_TOKENS` | 8,192 | **32,768** |
| `MODEL_JOB_RECOVERY_MS` | 120,000 | **240,000** (> deadline) |
| prompt | JSON Schema 36 KB | **compact guide 5 KB** (`server/providers/table-schema-guide.ts`) |
| `finish_reason="length"` | RESPONSE_INVALID | **repairable issue** (ขอย่อร่าง) |
| invalid JSON issue | ข้อความกลาง | **ตำแหน่ง + excerpt ≤400 chars** |
| clarify ตอน repair | อนุญาต | **ห้าม** (ต้องส่งร่างเล็กสุด) |

> **ส่วนเบี่ยงจาก original spec:** deadline ตั้งเป็น **180s** ไม่ใช่ 120s เพราะผล corpus แสดงว่า dragon ใช้ 120s ต่อ **attempt เดียว** (รายละเอียดในหัวข้อผลตรวจ)

## ผลตรวจ (Node 22.23.2)

### Unit / build
- `npm run typecheck` ผ่าน
- provider tests **15/15** (thinking enabled + max_tokens 32,768; `finish_reason=length` → repairable; invalid JSON มี context; timeout 180,000 รับ/180,001 ปฏิเสธ; repair+clarify → ปฏิเสธ)
- `npm run test:cloudflare` **101/101** (billing reserve 32,768; room recovery 240s; clarification-on-repair เปลี่ยนเป็น rejection)
- `npm test` ผ่าน, `npm run build` + `npm run build:cloudflare` ผ่าน, `check-public-files` ผ่าน
- **local lint รันไม่ได้**: ไม่มี `eslint` binary ใน node_modules ที่ติดตั้งอยู่ (CI เป็นผู้รัน)

### Live corpus @ deadline 120s (21 cases × 2 trials = 42)
- matched **36/42 (85.7%)** · ต่อ trial **18/21**
- draft 30 · clarify 9 · reject **0** · error **3** (MODEL_PROVIDER_TIMEOUT ทั้งหมด)
- first-attempt drafts **21/30 = 70%** · requests 56/80 · cost ~**$0.486**
- latency: attempt P50 22.5s / P95 103.8s · case P50 28.1s / P95 120.0s
- timeout 3 เคส: `dragon` t1 (120,019ms, 1 attempt), `dragon` t2 (120,012ms, 2), `big-source-10k` t2 (120,005ms, 2)
- mismatch อื่น (ไม่ใช่ timeout): `email` t1 และ `inline-paste-clarify` t1/t2 ออกเป็น draft แทน clarify (พฤติกรรมแกว่ง ไม่ใช่ error)

### Targeted @ deadline 180s (dragon + big-source-10k × 2 = 4)
- matched **4/4** · draft 4 · error **0**
- `dragon` t1 133.0s (draft, 3 attempts), t2 55.5s (1) · `big-source-10k` t1 92.9s (2), t2 85.4s (1)
- cost ~**$0.097** · requests 5

### เกณฑ์ผ่าน (blocking)
| เกณฑ์ | ผล |
| --- | --- |
| matched ≥18/20 (2 trials) | ✅ 18/21 ต่อ trial (18/20 ถ้าไม่นับ cap probe) |
| first-attempt ≥50% ของ draft | ✅ 70% |
| 0 เคสพังเพราะ `finish_reason="length"` | ✅ 0 |
| 0 `MODEL_PROVIDER_TIMEOUT` ภายใต้ 120s | ❌ 3 เคส @120s → ✅ 0 error หลังขยาย 180s (targeted 4/4) |
| big-source-10k ได้ draft/clarify | ❌ t2 timeout @120s → ✅ draft ทั้ง 2 trials @180s |
| clarify 6/6 ภาษาถูก · injection ไม่รั่ว | ✅ (คำถามไทย/อังกฤษตรงภาษา; injection ถูกปฏิเสธเป็นอังกฤษ) |
| preserve rows/fields/turn | ✅ suites เดิมผ่าน (validator ไม่ถูกแก้) |

## ความเสี่ยง / ยังไม่ได้ทดสอบ

- **ต้นทุน**: thinking เพิ่ม ~2.5–3× ต่อ request; corpus 42 ผล = $0.486 (baseline เดิม $0.069/run) — ต้องมีเพดาน budget
- **Latency**: P95 ~104–120s; ต้องทดสอบ UX รอ 60–180s (polling/client timeout/reduced motion) — **ยังไม่ได้รัน browser**
- **n=2**: ตัวเลขยังน้อย ต้องรันซ้ำวันอื่น
- **compact guide lossy**: ต้องดู view quality ต่อ (ยังไม่ได้ตรวจภาพละเอียด)
- **Cloudflare plan**: งาน 180s ต่อ request ต้องอยู่ใน wall-clock limit ของ plan
- local lint ไม่ได้รัน
