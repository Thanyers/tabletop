# F045 — เห็นสิ่งที่โมเดลกำลังทำ + แยก timeout ของเราออกจากผู้ให้บริการ

| | |
| --- | --- |
| สถานะ | `todo` (มี T1 ทำแล้วใน session 2026-10-22) |
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

## งาน

| ID | งาน | ไฟล์/พื้นที่ | เกณฑ์เสร็จ |
| --- | --- | --- | --- |
| F045-T1 | UI: 180s server limit + thinking/answer counters | `src/tabletop/ui/useTableChat.tsx` | typecheck/build ผ่าน; ข้อความไม่โชว์ 120s อีก |
| F045-T2 | Draft SSE: `stream:true`, accumulate content/reasoning, `onProgress` throttled ~900ms | `server/providers/deepseek-changes.ts`, `cloudflare/ai.ts` | provider ส่ง progress; JSON ที่สำเร็จยังผ่าน validator เดิม; non-SSE fallback ผ่าน test เดิม |
| F045-T3 | Room: เก็บ progress ของ model job + failure details; client type/UI | `cloudflare/room.ts`, `cloudflare/room-repository.ts`, `src/tabletop/client.ts`, `ui/useTableChat.tsx` | job view มี `progress` และ `failureDetails`; การ์ดร่างแสดงระหว่างรอ |
| F045-T4 | Partial on timeout: error carrying `{timedOutBy, limitMs, elapsedMs, receivedChars, reasoningChars, partialContent}`; store bounded/redacted | `server/providers/deepseek-changes.ts`, `cloudflare/ai.ts`, `cloudflare/room.ts`, `cloudflare/model-failure.ts` | unit: timeout after N chars → job failed with details; UI แสดง "stopped at our limit" |
| F045-T5 | Deadline config: `AI_TABLE_DEADLINE_MS` default 240,000 max 300,000; align `MODEL_JOB_RECOVERY_MS` = deadline+120s, client poll = deadline+70s, provider max timeout | `cloudflare/room.ts`, `cloudflare/ai.ts`, `server/providers/deepseek-changes.ts`, `ui/useTableChat.tsx`, tests | dragon/big-source live probe ผ่านที่ 240s; ไม่มี job ถูกตีเป็น interrupted ก่อน deadline |
| F045-T6 | Tests + live probe + production receipt | tests, `docs/DEPLOYMENTS.md` | `npm test`, `test:cloudflare`, browser suite; live 2 cases; `/version` ตรง tag |

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
