# F079 — Retire or freeze the Procedural surface

| | |
| --- | --- |
| สถานะ | `done` — เลือก **B (freeze)** เมื่อ 2026-10-25; โค้ดอยู่ใน `legacy/` และออกจาก build แล้ว |
| เจ้าของฟีเจอร์ | product owner (อนุมัติ B); implementation โดย DeepSeek Harness |
| เวอร์ชันที่คาด | PATCH ของ docs/config; การเลิกให้บริการ `?legacy-demo=1` ต้องระบุใน release note |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F079` |

## ทำไม

Tabletop โตมาจากโปรเจกต์ก่อนหน้าที่ชื่อ Procedural: single-user "Living Software Workspace" พร้อม Trio demo (shipping contract, encounter, band rehearsal), accounting story และ Component Lab. โค้ดชุดนั้นเคยอยู่ใน `src/` ทั้งชุดและยัง build/typecheck/lint/นับเป็น surface ที่ทุก session ของ agent ต้องอ่าน แม้ [`product.md`](../../product.md) จะอธิบายเฉพาะ shared table และ demos ที่ `/demo` (Invoice, Physics, Encounter) ซึ่งเป็นโค้ด Tabletop ไม่ใช่ Procedural

F078 (architecture review 2026-10-24) จัดเรื่องนี้เป็น candidate ที่ 3 และระบุว่าเป็นการตัดสินสินค้า ไม่ใช่ refactor. เอกสารนี้เก็บหลักฐานและทางเลือก; เจ้าของผลิตภัณฑ์เลือก **B (freeze)** เมื่อ 2026-10-25 — โค้ดถูกย้ายไป `legacy/` แล้ว ไม่ถูกลบ

## สิ่งที่ผู้ใช้จะเห็น

- วันนี้: `?legacy-demo=1` เปิด Procedural shell (Trio/accounting) ที่ `/`; `/demo` และ `/demo/replay` เป็นหน้า public ตามปกติและ **ไม่ใช่** ส่วนที่จะถูก retire
- ถ้าเลือก B: `?legacy-demo=1` หยุดทำงาน (หรือย้ายไป branch `legacy`), หน้า `/demo` ไม่เปลี่ยน
- ถ้าเลือก A: เหมือน B และไม่มีโค้ดชุดนี้ใน repo อีก

## ข้อเท็จจริงจากโค้ด (dev `9574dc0`, 2026-10-25)

| พื้นที่ | ไฟล์ | TS/TSX บรรทัด | ขนาดไฟล์ |
| --- | --- | --- | --- |
| `src/trio/` | 66 | 10,409 | 831,244 B |
| `src/components/` | 28 | 3,658 | 452,155 B |
| `src/domain/` (Procedural) | 19 | 4,330 | 208,976 B |
| `src/state/` | 8 | 582 | 72,885 B |
| `src/lab/` | 9 | 764 | 75,414 B |
| `src/App.tsx` + `src/LegacyEntry.tsx` | 2 | 247 | 48,462 B |
| **รวม** | **132** | **19,990** | **1,689,136 B** |

เทียบกับ `src/` ทั้งหมด: 317 ไฟล์ / 57,759 บรรทัด → legacy คิดเป็น **34.6% ของบรรทัด** และ **~1.6 MB** ของ source (รวม CSS ในโฟลเดอร์เหล่านั้น)

การเข้าถึง:

- `src/main.tsx` เลือก entry ด้วย `location.search.get('legacy-demo') === '1' ? import('./LegacyEntry') : import('./tabletop/TabletopApp')` — lazy import แยก chunk แล้ว ดังนั้น **first load ของ `/` ไม่ได้จ่ายค่าน้ำหนักนี้**; สิ่งที่ยังจ่ายคือ tsc/eslint/vitest/agent context
- `LegacyEntry.tsx` → `App.tsx` เป็นผู้ใช้ `TrioExperience`/`TrioCanvas`/`Lab` และเป็นทางเข้าเดียวของ `src/App.tsx`
- หลัง F078-T12: `src/tabletop/**` **ไม่ import** `components/`, `state/`, `trio/` หรือ `lab/` แล้ว เหลือ dependency เดียวที่ยังชี้เข้า legacy คือ test-only: `src/tabletop/shared/edge-routing.test.ts` ใช้ `makeObject` จาก `src/state/objects` (ต้องย้าย helper ก่อนลบ `src/state`)
- `src/tabletop/demo/**` (หน้า `/demo`), `src/tabletop/testing/**` และ workbench เดิมไม่ใช่ legacy — อยู่ในผลิตภัณฑ์ปัจจุบัน

การทดสอบและ CI:

- `tests/` มี 53 spec; **44** เป็นของ Procedural/Trio/Component Lab (`trio-*`, `demo-*`, `constellation-*`, `browser.mjs`, `spatial-learning.mjs`, `component-lab-*`, ฯลฯ)
- CI ไม่รัน 44 spec เหล่านี้: งาน browser ใน `.github/workflows/validate.yml` รัน `npm run demo:auto:run`, `test:r1:browser` (`tests/tabletop-r1.mjs`), `tests/ui/f066-rules-browser.mjs` และ Cloudflare browser suite เท่านั้น; `test:browser`/`test:spatial`/`test:constellation` ใน `package.json` ไม่ถูกเรียกจาก CI
- unit test ของ legacy: 12 ไฟล์ใต้ `src/trio/**` + 4 ไฟล์ใต้ `src/state/**` + 9 ไฟล์ใต้ `src/domain/**` + 2 ไฟล์ใต้ `src/lab/**` — รันใน `npm test` ทุกครั้ง

เอกสารและ manifest:

- `docs/source-baseline.json` เป็น hash manifest ของไฟล์ Procedural ทั้งชุด (`src/App.tsx`, `components/`, `domain/`, `lab/`, `trio/`, `scripts/component-lab/`, `tests/trio-*`)
- ไม่มีเอกสารเจ้าของเรื่องสำหรับ Trio/Component Lab; `product.md` ไม่ได้กล่าวถึงทั้งสอง
- Component Lab เป็น Vite `serve`-only middleware + hostname gate (`src/lab/useComponentLab.tsx`, `scripts/component-lab/plugin.ts`) — เข้าไม่ได้บน Worker ที่ deploy แล้ว

## ทางเลือก

**A. Retire + delete** — ย้าย `makeObject` helper ที่ test ใช้ก่อน, ลบ 132 ไฟล์ + 44 spec + `scripts/component-lab/**` + Vite plugin + `LegacyEntry` branch ใน `main.tsx`, ปรับ `docs/source-baseline.json` และ `docs/` ที่อ้างถึง
ข้อดี: source เล็กลง 34.6%, tsc/eslint/vitest/agent context ลดจริง, ไม่มี surface ที่ไม่มีเจ้าของ
ข้อเสีย: ประวัติการทดลองหายจาก working tree (ยังอยู่ใน git history), ถ้ามีคนบุ๊กมาร์ก `?legacy-demo=1` จะเจอ 404/`/` ปกติ, ต้องมีคนรับผิดชอบตัดสิน

**B. Freeze outside the build (แนะนำให้เริ่มที่นี่)** — ย้ายทั้งชุดไป `legacy/` ที่ root, ตัด `?legacy-demo=1` ออกจาก `main.tsx`, เอา `legacy/` ออกจาก `tsconfig` includes, `eslint` ignores, `vitest` includes, และ Vite entry; เก็บ `docs/source-baseline.json` และเอกสารอ้างอิงไว้เป็นบันทึก
ข้อดี: tsc/eslint/vitest/agent context ลดเท่า A ทันที; ยังตรวจย้อนได้ใน repo; ย้อนกลับง่าย ( revert PR เดียว); ไม่ต้องตัดสินเรื่องลบถาวรวันนี้
ข้อเสีย: ยังมีไฟล์อยู่ใน repo (แต่ไม่มีใคร build/อ่านเป็นค่าเริ่มต้น), ต้องมีวินัยไม่ให้กลับมา import

**C. Keep and document** — คงทุกอย่างและเพิ่มส่วน "Procedural surface" ใน `product.md` ระบุเจ้าของและสถานะ (maintained demo หรือ frozen)
ข้อดี: ไม่เสียอะไร
ข้อเสีย: 34.6% ของ source ยังไม่มีเจ้าของ, spec 44 ตัวยังไม่ถูกรัน, และ architecture review รอบหน้าจะเสนอเรื่องเดิมอีก

## ผลกระทบถ้าเลือก B หรือ A

- `src/main.tsx`: ตัด branch `legacy-demo` (เหลือ `/demo`, `/demo/replay`, `/` → `TabletopApp`)
- `src/LegacyEntry.tsx`, `src/App.tsx`, `src/trio/**`, `src/components/**`, `src/state/**`, `src/domain/**`, `src/lab/**`: ออกจาก build graph
- test helper: `src/tabletop/shared/edge-routing.test.ts` ต้องเปลี่ยนไปใช้ fixture ของตัวเอง (dependency สุดท้ายที่ชี้เข้า legacy)
- `scripts/component-lab/**`, `vite.config.ts` plugin, `tests/component-lab-*.mjs`, `tests/trio-*.mjs`, `tests/browser.mjs`, `tests/spatial-learning.mjs`, `tests/constellation-demo.mjs` และ spec legacy อื่น: ออกหรือย้ายตาม
- `package.json`: `test:browser`, `test:spatial`, `test:constellation` และ `demo:auto*` ต้องทบทวน (`demo:auto` ใช้ Tabletop demo ไม่ใช่ Trio)
- `docs/source-baseline.json` และเอกสารที่อ้าง path legacy: ปรับหรือ freeze ตาม
- **ไม่กระทบ**: `/demo` และ `/demo/replay` (Tabletop demo), product.md demos (Invoice/Physics/Encounter), Worker/Room, contract ใด ๆ

## สิ่งที่ทำจริง (option B — freeze, 2026-10-25)

- `git mv` → `legacy/`: `App.tsx`, `LegacyEntry.tsx`, `styles.css`, `workspace-v3.css`, `theme.css`, `trio/`, `components/`, `state/`, `domain/`, `lab/` (132 ไฟล์, 19,990 บรรทัด TS/TSX) และ `scripts/component-lab/` → `legacy/scripts/component-lab/`
- `src/main.tsx`: ตัด branch `?legacy-demo=1` แล้ว; `/`, `/demo`, `/demo/replay` ยังทำงานเหมือนเดิม
- `vite.config.ts`: ตัด `componentLabPlugin` ออกจาก dev server
- `eslint.config.js`: ignore `legacy/`
- `src/tabletop/shared/edge-routing.test.ts`: ใช้ geometry fixture ของตัวเองแทน `makeObject` จาก `src/state/objects` — ไม่มี dependency จาก `src/` เข้า `legacy/` เหลืออยู่
- guard test `src/tabletop/legacy-boundary.test.ts` (5 เคส): ตรวจว่า legacy ไม่อยู่ใน `src/`, boot ไม่เลือก legacy, ไม่มี import จาก `src/` เข้า `legacy/`, tsconfig/eslint/vite ไม่เห็นมัน, และ dev server ไม่มี middleware ของ lab
- วัดผล: unit **981 → 808 passed** (legacy unit 28 ไฟล์/173 เคสออกจากชุด), lint warning 118 → 66, `build` ผ่านโดยไม่มี legacy chunk, Workers 236/236 เท่าเดิม

สิ่งที่ **ไม่ทำ** ในรอบนี้: ไม่ลบไฟล์ (สำหรับ option A ภายหลัง), ไม่ย้าย `tests/` spec ของ legacy (44 ไฟล์ยังอยู่ แต่ไม่ถูก CI เรียก และ script `test:browser`/`test:spatial`/`test:constellation` ถูกเอาออกแล้วเพื่อไม่ให้เรียก spec ที่ตาย), และ `docs/source-baseline.json` ยังเก็บ path เดิมเป็นบันทึกประวัติ

## คำถามเปิด (เหลือ)

1. จะลบ `legacy/` จริง (option A) หลังปล่อยรุ่นถัดไปหรือไม่?
2. จะย้าย/ลบ spec 44 ไฟล์กับ `package.json` scripts (`test:browser`, `test:spatial`, `test:constellation`) เมื่อไร?
3. มีลิงก์ภายนอก `?legacy-demo=1` ที่ต้องแจ้งเจ้าของก่อนหรือไม่?

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-25 | บันทึกเป็นข้อเสนอ ยังไม่ลบหรือย้ายโค้ด | F078 candidate 3 เป็นการตัดสินสินค้า; ต้องมีเจ้าของเคาะก่อน |
| 2026-10-25 | เลือก B (freeze outside the build): ย้ายไป `legacy/`, ตัด entry/config, ไม่ลบ | ลด surface ของ tsc/eslint/test/agent ทันที, ย้อนกลับได้ด้วย revert PR เดียว, และยังไม่ตัดสินเรื่องลบถาวร |

## Verification

- `npm run typecheck` (3 config) ผ่าน
- `npm test` **808 passed / 5 skipped (813)** (legacy unit 173 เคสออกจากชุดตามที่ freeze)
- `npm run test:cloudflare` **236 / 236**
- `npm run build` ผ่าน; ไม่มี legacy chunk ใน `dist/assets`
- `npm run lint` **0 errors / 66 warnings**
- `node scripts/check-public-files.mjs` และ `git diff --check` ผ่าน
- browser suites: CI ของ PR ยังรัน `local-validation`; dev run หลัง merge เป็นตัวยืนยัน `/` และ `/demo` ตามปกติ
