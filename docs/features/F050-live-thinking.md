# F050 — เห็น "กำลังคิดอะไร" แบบสดระหว่างรอร่างกฎ

| | |
| --- | --- |
| สถานะ | `doing` — เปิด draft PR หลังจองงาน |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เพิ่มฟิลด์ optional ใน progress ของ job ที่กำลังรัน (ไม่แตะ JSON ที่สำเร็จ) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F050-T*` |
| ต่อจาก | [F045](F045-transparent-streaming-timeout.md) |

## ทำไม

F045 ทำให้การ์ดระหว่างรอมีตัวเลข (`42s / 240s server limit · thinking 8,200 chars · answer 1,300 chars`) และเก็บข้อความ thinking ไว้แสดง **เฉพาะตอนที่ร่างล้ม** (bounded tail ≤600 ตัวอักษร) แต่ผู้ใช้ขอสิ่งที่มากกว่านั้น: ระหว่างรอต้องเห็นว่าโมเดล **กำลังทำอะไร** เป็นข้อความที่ไหลมา ไม่ใช่ตัวเลขเพิ่มขึ้นเฉย ๆ

ข้อเท็จจริงจากโค้ด 5.1.0:

| ชั้น | สถานะก่อน F050 |
| --- | --- |
| provider (`server/providers/deepseek-changes.ts`) | อ่าน `delta.reasoning_content` แล้วเก็บ `thinkingTail` (≤600) ไว้ใน local state **แต่ `onProgress` ส่งแค่ `{receivedChars, reasoningChars}`** |
| worker (`cloudflare/room.ts`) | throttle 900 ms แล้วเขียน `{receivedChars, reasoningChars, updatedAt}` — **ทิ้ง tail** |
| contract (`src/tabletop/shared/model-job-progress.ts`) | `ModelJobProgress.thinkingTail?` มีอยู่แล้ว และ `parseModelJobProgress` คงค่าไว้ ⇒ ปลายทางพร้อมรับ แต่ไม่มีใครส่ง |
| client (`src/tabletop/ui/useTableChat.tsx`) | `ElapsedLabel` แสดงตัวเลขเท่านั้น |

สาเหตุที่ "แก้แล้วแต่ไม่เห็น" คือ decision ของ F045 เอง: *"เก็บ `thinkingTail` เฉพาะตอนล้ม ไม่เก็บใน progress ที่ไหลทุก ~900ms"* — ตัวเลขจึงเป็นสิ่งที่ผู้ใช้เห็นจริง ๆ

## สิ่งที่ผู้ใช้จะเห็น

1. ระหว่างรอ การ์ดร่างกฎมีบรรทัด **live thinking** ใต้ตัวเลข: ข้อความท้ายของ thinking (≤280 ตัวอักษร) ตัดที่ขอบคำและขึ้นต้นด้วย `…` เมื่อถูกตัด — ขยับไปข้างหน้าตามที่โมเดลคิด
2. ถ้าข้อความที่เก็บยาวกว่าบรรทัดนั้น มี `<details>` **More of the latest thinking** แสดง tail เต็ม (≤600 ตัวอักษร)
3. ตัวเลขเดิม (`42s / 240s server limit · thinking 8,200 chars · answer 1,300 chars`) ยังอยู่ ไม่เปลี่ยนความหมาย
4. ถ้าร่างล้ม ยังได้การ์ดเดิมของ F045 (เหตุผลที่หยุด + partial answer + thinking tail)

## ขอบเขต

**รวม:** ส่ง bounded/redacted thinking tail ไปกับ progress ของ job ที่กำลังรัน · แสดงแบบสดใน client · fixture ที่ stream reasoning ได้จริง · unit/worker/browser test · เอกสาร

**ไม่รวม:** เปิด chain-of-thought ทั้งก้อน · streaming token ผ่าน WebSocket ใหม่ · เปลี่ยนสัญญา JSON ที่สำเร็จ · เปลี่ยนเพดานเวลา/deadline · คำตอบของ assistant (ยังไม่มี reasoning)

## หลักการ

1. **ไหลผ่านช่องทางเดิม** — job row + poll 1.2s; ไม่มี socket ใหม่
2. **redact ก่อน clamp** — ใช้ `redactString` ตัวเดิมของ assistant; ถ้าสร้าง identity replacements ไม่ได้ (`null`) ให้ **ทิ้งข้อความ** ไม่เก็บดิบ
3. **จำกัดขนาด** — tail ≤600 ตัวอักษรต่อ progress tick (เขียนจริงไม่เกิน ~1 ครั้ง/900 ms)
4. **display ไม่ผูกกับ contract** — บรรทัดที่ผู้ใช้เห็นถูกตัดที่ client อีกชั้น (280 ตัวอักษร) เผื่อ payload เก่าหรือใหญ่ผิดปกติ
5. **rollback ได้** — ฝั่งเก่าไม่รู้จัก `thinkingTail` ก็เพิกเฉย และยังอ่าน `receivedChars`/`reasoningChars` ได้

## สัญญาที่เปลี่ยน

`ModelJobProgress` (progress ของ job ที่กำลังรัน) เพิ่มฟิลด์ optional:

```jsonc
{
  "progress": {
    "receivedChars": 1300,
    "reasoningChars": 8200,
    "thinkingTail": "…last bounded characters of the model's thinking…", // ≤600, redacted
    "updatedAt": 1761…
  }
}
```

- ไม่มีผลกับ response ที่สำเร็จ หรือ `failureDetails` (ของเดิม)
- `parseModelJobProgress` ยังเป็นผู้ตรวจขอบเขตตอนอ่าน row (≤600, ตัด surrogate pair)
- job ของ assistant ไม่เปลี่ยน (`table-assistant-contracts.ts` ยังเป็น strictObject โดยไม่มี key นี้)

## งาน

| ID | งาน | ไฟล์/พื้นที่ | เกณฑ์เสร็จ |
| --- | --- | --- | --- |
| F050-T1 | provider: ส่ง `thinkingTail` ไปกับ `onProgress` | `server/providers/deepseek-changes.ts` | unit: tail ที่ส่ง = ท้ายข้อความ ≤600 และ reasoningChars ตรง |
| F050-T2 | worker: redact + เขียน tail ลง progress | `cloudflare/room.ts` | worker test: job ที่รันอยู่เห็น tail ≤600 และไม่มีชื่อ/ID ของสมาชิก |
| F050-T3 | UI: บรรทัด live thinking + details | `ui/table-chat-state.ts`, `ui/useTableChat.tsx`, `ui/table-chat.css` | unit ของ `liveThinkingLine` + browser: เห็นบรรทัดและข้อความขยับระหว่าง stream |
| F050-T4 | fixture + browser coverage | `tests/cloudflare-browser.mjs`, `tests/generic-table-browser.mjs` | fixture stream reasoning จริงผ่าน SSE; check ผ่านติดกัน 2 รอบ |
| F050-T5 | เอกสาร + CHANGELOG + spec | `docs/features/F050-live-thinking.md`, `CHANGELOG.md`, `spec.md`, `PLAN.md` | ผลตรวจจริงระบุใน spec |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | **กลับ** decision ของ F045: ส่ง thinking tail ไปกับ progress ที่ไหลระหว่างรัน (ไม่ใช่เฉพาะตอนล้ม) | ผู้ใช้ขอเห็นว่าโมเดลกำลังทำอะไรระหว่างรอ; ขนาดต่อ tick ≤600 ตัวอักษร และ redact ด้วยชุดเดียวกับ failure details แล้ว |
| 2026-10-22 | แสดงเป็น "บรรทัดล่าสุด" 280 ตัวอักษร + details 600 ไม่ใช่กล่องข้อความยาว | การ์ดอยู่ใน canvas ที่ต้องไม่ล้นจอ 320px และไม่ควรกลายเป็นหน้าต่าง chain-of-thought |
| 2026-10-22 | ตัดที่ขอบคำและเติม `…` เมื่อถูกตัด | บรรทัดที่ขึ้นต้นด้วยคำครึ่งท่อนอ่านเหมือนบั๊ก ไม่เหมือน "กำลังทำอะไร" |
| 2026-10-22 | assistant (ask) ไม่เปลี่ยน | เส้นทางนั้นยังไม่มี reasoning content และไม่ใช่จุดที่ผู้ใช้ติด |

## ความเสี่ยง

- **ขนาด job row:** เขียน tail ทุก ~900 ms ทำให้ data ของ job โตขึ้นชั่วคราว ≤600 ตัวอักษร — ยังอยู่ในขอบ `json_set` เดิม; job ที่จบแล้วจะถูกเขียนทับด้วยผลลัพธ์
- **ความเป็นส่วนตัว:** ข้อความมาจากผู้ให้บริการ อาจมีชื่อ/อีเมลในบริบทโต๊ะ → ใช้ `redactString` + `createIdentityReplacements` ชุดเดียวกับ F045 และทิ้งข้อความเมื่อสร้างชุดแทนไม่ได้
- **Flaky browser:** fixture ต้อง stream ช้า (~90 ms/chunk) พอให้ poll 1.2s เห็นการเปลี่ยนแปลงอย่างน้อยหนึ่งครั้ง

## ผลตรวจ

Node **22.23.2** (รุ่นเดียวกับ CI) · branch `feat/F050-live-thinking` แตกจาก `origin/dev` @ `9ff8dd4`

| คำสั่ง | ผล |
| --- | --- |
| `npx vitest run server/providers/deepseek-changes.test.ts src/tabletop/ui/table-chat-state.test.ts` | **45/45** — provider 22 (เพิ่มเคส tail ≤600 ใน progress) + chat-state 23 (เพิ่ม `liveThinkingLine` 4 เคส) |
| `npm test` | **568 passed / 1 skipped** (83 ไฟล์; ก่อนหน้า 563) |
| `npm run test:cloudflare` | **126/126** (9 ไฟล์; เพิ่มเคส `F050` ที่ยืนยัน tail ถูก redact/จำกัด 600 บน job ที่กำลังรัน) |
| `npm run typecheck` (ใน `npm run build`) | 0 |
| `npm run lint` | 0 error / 103 warning (เท่าเดิม ไม่มีใหม่) |
| `node scripts/check-public-files.mjs` | 0 finding |
| `npm run build` + `npm run build:cloudflare` | ผ่าน |
| `BROWSER_CHANNEL=msedge npm run test:cloudflare:browser` | **27 PASS ติดกัน 2 รอบ** หลัง build สุดท้าย (exit 0, ไม่มี FAIL) — fixture stream reasoning จริง 24 delta × 90 ms ผ่าน SSE แล้ว assert ว่าบรรทัด live thinking โผล่และขยับ |

อาร์ติแฟกต์: `test-results/f050-browser-run{3,4,5,6}.log` · ภาพการ์ดระหว่างสตรีม `test-results/f050-live-thinking.png` (สร้างเมื่อรันด้วย `F050_SHOT=1` เท่านั้น ไม่ผูกกับ CI)

ภาพที่เห็น: การ์ดร่างกฎระหว่างรอมี `2s / 240s server limit · thinking 957 chars` แล้วบรรทัด `…15. Checking source columns and drafting rule 16. Checking source columns…` พร้อม `More of the latest thinking` — ข้อความขยับทุกครั้งที่ poll ได้ progress ใหม่

## หมายเหตุถึงข้อ Complaint "การ์ดหายเงียบ"

อาการที่ผู้ใช้รายงานว่า "ผ่านหมดแล้วการ์ดหาย" **ไม่ใช่** อาการที่ F050 ทำให้เกิด — มันคือพฤติกรรมจาก #156/#157 ที่ตั้งใจเอาการ์ดที่ auto-apply แล้วออกจาก canvas แล้วแทนด้วยแถบ "New rules added …" 15 วินาที — และแถบนั้นยิงจาก effect ที่ต้องเห็นการ์ดในสถานะ sending/waiting ก่อน ถ้าการ์ดจบเร็วหรือหน้านั้นเพิ่งเปิด การ์ดจะถูกกรองออกโดยไม่มีแถบแทน ⇒ **หายเงียบ** · F050 แก้ส่วนนี้ด้วย: การ์ดที่ `createdAt >= mountedAt` (เกิดหลังเปิดหน้า) นับว่า "เห็นแล้ว" และแจ้งเตือนเสมอ · การ์ดเก่าที่จบก่อนเปิดหน้ายังไม่แจ้ง (ตั้งใจ) · ถ้าต้องการให้การ์ดผลลัพธ์ค้างบน canvas เอง นั่นคือการกลับ decision ของ #157 ต้องให้เจ้าของผลิตภัณฑ์ตัดสิน

