# F045 — เห็นสิ่งที่โมเดลกำลังทำ + แยก timeout ของเราออกจากผู้ให้บริการ

| | |
| --- | --- |
| สถานะ | T1–T5 merge เข้า `dev` แล้ว ([PR #155](https://github.com/Thanyers/tabletop/pull/155) @ `79749ab`) · T6 (receipt บน production) รอ release |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เปลี่ยนสัญญา progress/failure ของ job และเปิด streaming ของเส้นทางร่างกฎ |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F045-T*` |

## ทำไม

ผู้ใช้เห็นคำตอบถูกตัดที่ปลายทาง แต่แยกไม่ออกว่า "โมเดลยังคิดอยู่และเราตัดที่ 180s" หรือ "ผู้ให้บริการหยุด/ช้าเอง" และระหว่างรอไม่เห็นอะไรนอกจากตัวเลขเวลา

ข้อเท็จจริงจากโค้ด 5.0.0:

| เส้นทาง | สถานะปัจจุบัน |
| --- | --- |
| assistant (ask) | SSE streaming จาก `feat/assistant-streaming` (#124, merge แล้ว อยู่ใน 4.3.0+) แต่เก็บแค่ `receivedChars`/`reasoningChars`; **ไม่เก็บข้อความ thinking** |
| ร่างกฎ (change this table) | `server/providers/deepseek-changes.ts` ตั้ง `stream: false`; ไม่มี progress; ตัดที่ deadline 180s รวมทุก attempt |
| timeout | `MODEL_PROVIDER_TIMEOUT` ข้อความเดียว; content ที่อ่านมาแล้วถูกทิ้ง |
| UI | `ElapsedLabel` เดิมโชว์ `/120s` สำหรับ assistant ทั้งที่ server อนุญาต 180s (แก้เป็น 180 + `server limit` แล้วใน T1) |

ผลคือ: ถ้าคำขอใช้ >180s จะไม่ได้ทั้งคำตอบและหลักฐานว่าคำตอบ "เกือบออก" แค่ไหน

## สิ่งที่ผู้ใช้จะเห็น

1. ระหว่างรอ: `42s / 180s server limit · thinking 8,200 chars · answer 1,300 chars`
2. ถ้าถูกตัด: การ์ดบอกชัดว่า **"หยุดที่เพดาน 180s ของเซิร์ฟเวอร์"** หรือ **"ผู้ให้บริการปิดการเชื่อมต่อ"** พร้อมจำนวน chars และปุ่ม `ดูข้อความบางส่วน`
3. ข้อความบางส่วน (≤4,000 ตัวอักษร) แสดงใน `<details>` แบบอ่านได้ ไม่ใช่ JSON ดิบทั้งก้อน
4. ไม่มีข้อความบางส่วนถูกส่งให้สมาชิกคนอื่นเกินขอบเขต: ใช้ข้อมูล job ที่สมาชิกในโต๊ะเห็นอยู่แล้ว และ redact ชื่อ/บัญชีเหมือนบริบท assistant

## ขอบเขต

**รวม:** streaming ของเส้นทางร่างกฎ · progress ที่มี thinking tail · เก็บ partial content ตอน abort · failure details · ปรับ deadline เป็นค่าคอนฟิก · test ของ SSE/timeout/partial · เอกสาร

**ไม่รวม:** เปิดเผย chain-of-thought เต็ม · เปลี่ยนโมเดล · streaming ระดับ token ไปยัง client แบบ WebSocket ใหม่ · auto-apply (F039)

## หลักการ

1. **ไหลผ่านช่องทางเดิม** — job + poll ที่มีอยู่; ไม่เพิ่ม socket ใหม่
2. **เก็บเท่าที่จำเป็น** — thinking tail ≤600 chars, partial content ≤4,000 chars, ลบข้อมูลระบุตัวตน
3. **ไม่เปลี่ยนสัญญา JSON ที่สำเร็จ** — streaming เป็นเพียงวิธีรับ; ยัง parse/validate JSON ก้อนเดิมก่อน commit
4. **fallback ได้** — provider ที่ไม่ส่ง SSE ยังใช้ JSON path เดิม
5. **แยกสาเหตุให้ชัด** — `MODEL_PROVIDER_TIMEOUT` + `timedOutBy` + `limitMs` + `elapsedMs`
6. **เวลาเป็นค่าคอนฟิก** — ไม่ hardcode 180 ใน UI/server สองที่

## สัญญาที่เปลี่ยน

job view ของเส้นทางร่างกฎ (`GET /api/workspaces/:id/model/:jobId`, และ response ของ `POST /model`) เพิ่มฟิลด์ optional ทั้งหมด:

```jsonc
{
  "id": "…", "status": "running",
  "limitMs": 240000,                                   // เพดานจริงของงานนี้
  "progress": { "receivedChars": 1300, "reasoningChars": 8200, "updatedAt": 1761… }
}
```

```jsonc
{
  "status": "failed", "failureCode": "MODEL_PROVIDER_TIMEOUT",
  "message": "Stopped at our 240s limit for one rule draft. It had received 1,300 characters of the draft. The partial text is kept below.",
  "failureDetails": {
    "timedOutBy": "server",                            // หรือ "provider"
    "limitMs": 240000, "elapsedMs": 240018,
    "receivedChars": 1300, "reasoningChars": 8200,
    "partialContent": "…≤4,000 ตัวอักษร หลัง redact…",
    "thinkingTail": "…≤600 ตัวอักษร หลัง redact…"
  }
}
```

| กรณี | code | `timedOutBy` | ข้อความ |
| --- | --- | --- | --- |
| ถึงเพดานของเรา | `MODEL_PROVIDER_TIMEOUT` | `server` | "Stopped at our {N}s limit…" |
| ผู้ให้บริการปิดสตรีมก่อนจบ | `MODEL_PROVIDER_REQUEST_FAILED` | `provider` | "The provider closed the connection…" |
| `finish_reason=length` | `MODEL_PROVIDER_OUTPUT_REJECTED` (ซ่อมได้) | — | คงเส้นทาง repair เดิม |

`finite` ของทุกฟิลด์ถูกตรวจซ้ำด้วย `parseModelJobProgress` / `parseModelFailureDetails` ตอนอ่านจาก row ก่อนส่งออก
และ `partialContent`/`thinkingTail` ถูก redact ด้วย `redactString` ตัวเดิมของ assistant **ก่อน** จำกัดความยาว

**deadline:** `AI_TABLE_DEADLINE_MS` (ms, default 240000, max 300000, ต่ำกว่า 60000 = ใช้ค่าเริ่มต้น)
· job recovery = deadline + 120s · client poll = deadline + 70s · provider per-attempt timeout ได้ `remaining` ของ deadline

## งาน

| ID | งาน | ไฟล์/พื้นที่ | เกณฑ์เสร็จ |
| --- | --- | --- | --- |
| F045-T1 | UI: 180s server limit + thinking/answer counters | `src/tabletop/ui/useTableChat.tsx` | typecheck/build ผ่าน; ข้อความไม่โชว์ 120s อีก |
| F045-T2 | Draft SSE: `stream:true`, accumulate content/reasoning, `onProgress` throttled ~900ms | `server/providers/deepseek-changes.ts`, `cloudflare/ai.ts` | provider ส่ง progress; JSON ที่สำเร็จยังผ่าน validator เดิม; non-SSE fallback ผ่าน test เดิม |
| F045-T3 | Room: เก็บ progress ของ model job + failure details; client type/UI | `cloudflare/room.ts`, `cloudflare/room-repository.ts`, `src/tabletop/client.ts`, `ui/useTableChat.tsx` | job view มี `progress` และ `failureDetails`; การ์ดร่างแสดงระหว่างรอ |
| F045-T4 | Partial on timeout: error carrying `{timedOutBy, limitMs, elapsedMs, receivedChars, reasoningChars, partialContent}`; store bounded/redacted | `server/providers/deepseek-changes.ts`, `cloudflare/ai.ts`, `cloudflare/room.ts`, `cloudflare/model-failure.ts` | unit: timeout after N chars → job failed with details; UI แสดง "stopped at our limit" |
| F045-T5 | Deadline config: `AI_TABLE_DEADLINE_MS` default 240,000 max 300,000; align `MODEL_JOB_RECOVERY_MS` = deadline+120s, client poll = deadline+70s, provider max timeout | `cloudflare/room.ts`, `cloudflare/ai.ts`, `server/providers/deepseek-changes.ts`, `ui/useTableChat.tsx`, tests | dragon/big-source live probe ผ่านที่ 240s; ไม่มี job ถูกตีเป็น interrupted ก่อน deadline |
| F045-T6 | Tests + live probe + production receipt | tests, `docs/DEPLOYMENTS.md` | `npm test`, `test:cloudflare`, browser suite; live 2 cases; `/version` ตรง tag |

## ผลตรวจ (2026-10-22, Node 22.23.2)

| คำสั่ง | ผล |
| --- | --- |
| `npx vitest run server/providers/deepseek-changes.test.ts` | **21/21** — stream split ที่ 1/3/11 ไบต์, reasoning counters, `finish_reason=length` ยังเป็น repair, timeout หลัง 40 ตัวอักษรมี details ครบ, provider-close + เพดาน 600/4,000, non-SSE fallback |
| `npm test` | **563 passed / 1 skipped** (82 ไฟล์) |
| `npm run test:cloudflare` | **125/125** (9 ไฟล์ · room 52, ai 18, model-failure 10, ai-deadline 3) |
| `npm run typecheck` | 0 |
| `npm run lint` | 0 error / 103 warning (warning เดิม ไม่มีใหม่) |
| `node scripts/check-public-files.mjs` | 609 ไฟล์ · 0 finding |
| `npm run build` + `npm run build:cloudflare` | ผ่าน · binding ไม่เปลี่ยน (ไม่ต้องตั้ง var ใหม่; ไม่ตั้ง `AI_TABLE_DEADLINE_MS` = 240s) |
| `npm run test:cloudflare:browser` (msedge) | **27 checks PASS ติดกัน 2 รอบ** (exit 0) ทั้งบน tree หลัง merge `dev` รอบแรกและรอบสุดท้าย (`n-browser6/7.log`) |
| `node --import tsx scripts/f045-live-probe.mjs --deadline=240000` | **PASS** — dragon draft 76.6s (attempt 1, 9,427 chars, thinking 59,311 chars) · big-source 10,000 chars draft 71.0s (attempt 2) ทั้งคู่ < 240s |

อาร์ติแฟกต์: `test-results/f045-live-2026-10-22T11-46-29-301Z/live-probe.{md,json}` · `test-results/n-browser6.log` · `test-results/n-browser7.log` (tree สุดท้ายหลัง merge `origin/dev` = `6576b15` ซึ่งแตะ `useTableChat.tsx`/`table-chat-state.ts`/`table-chat.css`/`tests/generic-table-browser.mjs` ร่วมกัน)

**หมายเหตุ browser:** ก่อน branch นี้ suite แดงอยู่แล้วที่ check เดียวกัน (`expected 'Draft ready for review'`) — ยืนยันด้วย baseline run บน tree สะอาดที่ stash งานทั้งหมดไว้ (`test-results/f045-browser-baseline.log`) ⇒ สถานะนี้มาจาก F039 (#133) ไม่ใช่ F045 · expectation เดิมรอสถานะชั่วคราวที่เกิดเฉพาะเมื่อ job `completed` มาถึงก่อน auto-apply ปรากฏใน projection (แข่งกันระหว่าง poll 1.2s กับ WebSocket push) ซึ่งไม่เกิดเลยบน Node 22.23.2 + msedge · แก้เฉพาะ expectation ใน `tests/cloudflare-browser.mjs` ให้ตรวจสถานะที่เกิดจริง ("Rules in use") ไม่ได้แตะโค้ดแอป และยังยืนยัน `candidate.status === 'active'` ต่อ

หลัง merge `dev` รอบที่สอง (#156 "กฎที่เพิ่มเองเป็นแถบแจ้งเตือน", #157 "การ์ดผลลัพธ์อยู่เฉพาะเมื่อยังมีอะไรให้ทำ") browser suite แดงเพิ่มที่ `tests/generic-table-browser.mjs` เพราะการ์ดที่ auto-apply แล้วถูกเอาออกจาก canvas — เป็น fixture ที่ #156/#157 ไม่ได้อัปเดต (CI ของ PR เข้า `dev` ไม่รัน browser ตาม CI005) · แก้ fixture ให้ตรวจแถบ "New rules added …" แทนการ์ดที่หายไป (ทดสอบยังยืนยัน `ruleRevision + 1/+2`, `candidate.status === 'active'` และ records ตามเดิม) · และพบข้อบกพร่องจริงของ #156: ปุ่ม **View rules** บนแถบถูก `header.tt-topbar` บังการคลิกใน viewport นี้ (Playwright: "`<a href="/demo">` from `tt-topbar` subtree intercepts pointer events") — fixture เปิดการ์ด Rules ผ่านเมนู Objects แทนการ force-click และรายงานไว้ให้เจ้าของ #156 แก้ stacking

## ลำดับ

T1 (ทำแล้ว) → T2 → T3 → T4 → T5 → T6 · T2/T3 ต้อง merge พร้อมกันเพราะ progress ต้องมีคนอ่าน; T5 ต้องรอ T4 เพราะต้องใช้ `limitMs` ค่าเดียวกัน

## ความเสี่ยง

- **SSE จากผู้ให้บริการ:** ต้องรองรับ chunk ที่ตัดกลางบรรทัด, `[DONE]`, usage chunk สุดท้าย, และ `finish_reason=length`
- **ขนาด job data:** `thinkingTail` + partial content ต้องไม่ทำให้ D1/DO row โต; จำกัด 600/4,000 chars และตัดที่ boundary
- **ความเป็นส่วนตัว:** partial content อาจมีข้อมูลโต๊ะ; ใช้ redaction เดิม (`redactString`) และแสดงเฉพาะสมาชิกที่เห็น job อยู่แล้ว
- **เวลา:** 240s ต้องอยู่ใน wall-clock ของ Cloudflare plan; ต้องวัดจริง ไม่เดา
- **Flaky browser:** รันซ้ำและบันทึก

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | streaming เฉพาะเส้นทางร่างกฎ; ไม่เปลี่ยน assistant ที่มีอยู่ | assistant มี SSE แล้ว; draft คือจุดที่ผู้ใช้ติด |
| 2026-10-22 | แสดง thinking เป็น "tail" ไม่ใช่ทั้งกระบวนการ | ลดข้อมูลส่วนตัว/ขนาด job และพอให้เห็นว่ากำลังทำอะไร |
| 2026-10-22 | เก็บ partial เมื่อ abort และติดไปกับ failure details | ตอบคำถาม "ข้อความออกหรือยัง" ได้ด้วยหลักฐาน |
| 2026-10-22 | deadline 240s เป็นค่าเริ่มต้น (max 300s) | 180s ใกล้ P95 ที่วัดได้ (~104s) และ dragon ใช้ 133s; 240s ให้ headroom โดยยังควบคุมได้ |
| 2026-10-22 | guard ของ raw SSE ฝั่ง provider = 16 MiB แต่เพดานข้อความที่ถอดแล้วยัง 256K ตัวอักษร | F041 วัดแล้วว่า envelope ~294 bytes/token; 1 MiB เดิมตัดกลางสตรีม · ไม่ใช่การขยายเพดานคำตอบ |
| 2026-10-22 | แยก "เพดานเรา" กับ "ผู้ให้บริการปิด" ด้วย `timedOutBy` ไม่ใช่ด้วย code เดียว | การ์ดต้องบอกได้ว่าใครหยุด และข้อความไม่ควรชี้ผิดฝ่าย |
| 2026-10-22 | เก็บ `thinkingTail` เฉพาะตอนล้ม ไม่เก็บใน progress ที่ไหลทุก ~900ms | ลดขนาด job row และลดข้อมูลส่วนตัวที่ไหลระหว่างทำงาน |
| 2026-10-22 | `AI_TABLE_DEADLINE_MS` ผิดรูปหรือต่ำกว่า 60s = ใช้ค่าเริ่มต้น; สูงกว่า 300s = clamp | config ที่ผิดต้องไม่ย่อ/ยืดเส้นทางอย่างเงียบ ๆ |
