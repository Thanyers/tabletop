# PLAN.md — กระดานงานของทีม

ใช้ไฟล์นี้ดูว่า **ใครกำลังทำอะไร ไฟล์ไหน** ก่อนหยิบงาน เพื่อไม่ให้สองคน (หรือสอง AI) แก้เรื่องเดียวกันพร้อมกัน
รายละเอียดของแต่ละฟีเจอร์อยู่ใน [`docs/features/`](docs/features/) ส่วนสถานะระบบที่เสร็จแล้วอยู่ใน [`spec.md`](spec.md)

## กติกา

1. **ก่อนหยิบงาน:** ดูตารางด้านล่าง แล้วรัน `gh pr list -R Thanyers/tabletop --state open` ว่าไม่มี PR ที่ชื่อขึ้นต้นด้วย ID เดียวกัน
2. **จองงาน:** แตก branch จาก `dev` (`feat/<ID>-<ชื่อสั้น>`) แก้แถวของงานนั้นในไฟล์นี้ (สถานะ `doing`, ผู้รับผิดชอบ, branch) แล้ว **เปิด draft PR ทันที** ชื่อ PR ขึ้นต้นด้วย ID เช่น `F001-T4: ...` · draft PR คือการจองที่ทุกคนเห็น
3. **แก้เฉพาะแถวของตัวเอง** อย่าจัดรูปแบบหรือเรียงตารางใหม่ จะได้ไม่ชนกับคนอื่น
4. **ดูคอลัมน์ "พื้นที่ที่แตะ":** ถ้างานที่ `doing` อยู่แตะไฟล์เดียวกับงานที่จะหยิบ ให้รอ หรือคุยกันก่อน · งานที่มี "ต้องรอ" ห้ามเริ่มจนงานนั้น `done`
5. **จบงาน:** PR พร้อม review → เปลี่ยนสถานะเป็น `review` · merge แล้ว (คนหรือ AI) → `done` (แก้ใน PR ถัดไปของคุณได้)
6. งานใหม่ที่ยังไม่มีใครจอง ให้เพิ่มไว้ใน feature doc ก่อน แล้วค่อยเพิ่มแถวที่นี่
7. **งานที่ `done` แล้วให้ลบแถวออก** ประวัติดูได้จาก git, PR, [`spec.md`](spec.md) และเอกสารใน `docs/features/` (ล้างครั้งล่าสุด 2026-10-22)

**สถานะ:** `todo` · `doing` · `review` · `done` · `blocked` (ใส่เหตุผลในคอลัมน์หมายเหตุ)

## จุดที่ชนบ่อย (hotspots)

ไฟล์เหล่านี้หลายงานแตะพร้อมกัน ให้แก้เท่าที่จำเป็นและ merge `dev` เข้า branch ตัวเองบ่อย ๆ:
`src/tabletop/TabletopApp.tsx` · `tests/generic-table-browser.mjs` · `tests/cloudflare-browser.mjs` · `tests/tabletop-r1.mjs` · `cloudflare/index.ts` · `CHANGELOG.md` (เพิ่มบรรทัดใต้ `Unreleased` เท่านั้น) · `spec.md`

## ฟีเจอร์

| ID | ฟีเจอร์ | สถานะ | เอกสาร |
| --- | --- | --- | --- |
| F001 | เริ่มโต๊ะใหม่ด้วยคำถาม + การ์ดเดโม + AI ช่วยเลือก + แชทแบบ island | `doing` (T1–T2 review) | [F001](docs/features/F001-guided-table-start.md) |
| F003 | ลิงก์เชิญเข้าโต๊ะแบบใช้ซ้ำได้ + เอาสมาชิกออก | `todo` (ต้อง security review ก่อน T3) | [F003](docs/features/F003-reusable-invite-link.md) |
| F004 | แยก URL path ให้แต่ละหน้า (`/`, `/new`, `/t/<id>`, `/join`) | `review` | [F004](docs/features/F004-url-paths.md) |
| F007 | ตำแหน่งการ์ดเป็นของทั้งโต๊ะ ทุกคนเห็นเหมือนกัน | `review` | [F007](docs/features/F007-shared-card-layout.md) |
| F034 | สมาชิกเห็นทุกอย่างในโต๊ะ + แชท AI และคำขอร่างกฎของทุกคน แบบสด (สวิตช์ `VISIBILITY_POLICY`, เก็บแบบ private ไว้) | `doing` | [F034](docs/features/F034-open-visibility.md) |
| F035 | Role permission ตั้งค่าได้ต่อโต๊ะและต่อคน: role ตั้งต้นตาม case + สร้างเอง · ค่าเริ่มต้น = เท่าเจ้าของยกเว้นลบ/รีเซ็ตโต๊ะ | `doing` | [F035](docs/features/F035-role-permissions.md) |
| F036 | ปลดเพดานเงินของ AI: ไม่จำกัดงบ แต่ยังบันทึกและ settle การใช้จริงทุกงาน (POC) | `review` | lead (AI) | `fix/F036-uncapped-budget` | `cloudflare/{billing,ai,index}.ts`, `vitest.cloudflare.config.ts`, tests | — | ไม่มี schema/binding/secret · CF 102, unit 476 |
| F037 | Comment card แบบ post-it บน canvas: สร้างจากปุ่มข้างแชท/แชท ลากย้าย แก้ข้อความ เปลี่ยนสี ลบ และเห็นร่วมกัน | `doing` | lead (AI) | `feat/F037-note-cards` | `shared/table-contracts.ts`, `domain/table.ts`, `runtime/index.ts`, `ui/*`, tests | — | เก็บนอก program (ไม่มี migration) · backend + unit 6 ผ่าน · UI ยังไม่ทำ |
| F042 | แจ้งคนที่เปิดหน้าอยู่ให้รีเฟรชเมื่อ release ใหม่ขึ้น staging/production | `review` | [F042](docs/features/F042-update-notice.md) |
| F038 | ถามขนานกันได้ระหว่างที่การ์ดอื่นทำงาน + คำขอร่างกฎเข้าคิวต่อจากร่างที่กำลังทำ | `done` (4.4.0) | [F038](docs/features/F038-parallel-requests.md) |
| F039 | กฎจาก AI เปิดใช้อัตโนมัติ (รันขั้นตรวจให้เอง) + เอากฎออกทีละรายการบนการ์ด Rules | `review` | [F039](docs/features/F039-auto-apply-rules.md) |
| F040 | Scene motion: วัตถุวิ่งวนจาก `from` ถึง `to` อัตโนมัติ ความเร็วจาก parameter + ปุ่มหยุด/reduced motion | `done` (5.0.0) | [F040](docs/features/F040-scene-motion.md) |
| F041 | เพดาน response ของ table assistant: กัน raw SSE 16 MiB แต่จำกัดคำตอบที่ถอดแล้ว 256K ตัวอักษร, output 32K, timeout 180s | `done` (5.0.0) | [F041](docs/features/F041-assistant-response-cap.md) |
| F044 | Scene motion hardening: fresh-build ต้องได้ scene, browser proof ของลูป/Pause, diagnostics ของ view ที่ถูกตัด, ตัดสินใจ shared phase และวัดเพดานจริงก่อนขยาย | `todo` | [F044](docs/features/F044-scene-motion-hardening.md) |
| F045 | เห็นความคืบหน้าระหว่างรอ (thinking/answer) + streaming เส้นทางร่างกฎ + เก็บ partial เมื่อ timeout + แยก "ตัดที่เพดานเรา" จาก "ผู้ให้บริการหยุด" | `doing` (T1–T5 merge เข้า `dev` แล้ว #155 · T6 รอ release) | [F045](docs/features/F045-transparent-streaming-timeout.md) |
| F048 | ลูกเต๋าที่ server ทอยให้เป็น parameter ของ action: `table.roll` + pending roll อายุ 10 นาทีผูก `dataRevision` + ใช้ครั้งเดียว + เก็บหน้าเต๋า/ผลรวมลง event | `review` | [F048](docs/features/F048-roll-parameter.md) |

## งาน

| ID | งาน | สถานะ | ผู้รับผิดชอบ | branch / PR | พื้นที่ที่แตะ | ต้องรอ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F027-T1 | reject บอกเหตุผลเชิงโครงสร้าง: เติม hint "join ข้าม collection ยังไม่รองรับ" เมื่อ reason ชี้ cross-record/cross-collection | `review` | ทีม Tabletop | `feat/F026-F027-reliability` | `cloudflare/model-failure.ts`, tests | — | unit ผ่าน ([F027](docs/features/F027-structural-reject-hint.md)) |
| F031-T1 | thinking generation + output caps 32K + deadline 120s + compact schema guide + parse diagnostics | `review` | ทีม Tabletop | `feat/F031-thinking-generation` | `server/providers/deepseek-changes.ts`, `cloudflare/{ai,billing,room}.ts`, `server/providers/table-schema-guide.ts`, `ui/*`, tests | — | เกณฑ์: matched ≥18/20, first-attempt ≥50%, 0 length-truncation ([F031](docs/features/F031-thinking-generation.md)) |
| F029-T1 | golden corpus 10 โจทย์ + วัด draft/clarify/reject rate (manual, ไม่ผูก CI) | `review` | ทีม Tabletop | `feat/F029-success-corpus` | `tests/corpus/table-prompts.json`, `server/corpus-success-rate.test.ts` | — | baseline 9/10 ([F029](docs/features/F029-golden-corpus.md)) |
| F028-T1 | fallback ตารางขั้นต่ำ: รอบที่ 4 ขอ 1 collection ≤4 fields ไม่มี canvas/join แล้วค่อย reject | `review` | ทีม Tabletop | `feat/F028-minimal-fallback` | `cloudflare/ai.ts`, `cloudflare/repair.ts`, tests | — | ลด reject จากเคส join ([F028](docs/features/F028-minimal-fallback.md)) |
| F025-T1 | แก้ refresh race: draft พร้อมแต่ขึ้น "The table could not refresh: The table changed" — เก็บ projection ล่าสุด + backoff แล้ว apply แทนการโยน error | `review` | ทีม Tabletop | `feat/F025-refresh-race` | `TabletopApp.tsx`, `ui/table-chat-state.ts`, tests | — | เจอ 1/10 บน production ([F025](docs/features/F025-draft-refresh-race.md)) |
| F026-T1 | บังคับภาษาคำถาม clarify ให้ตรงภาษาคำขอ (ตรวจอักษร + repair 1 รอบ) | `review` | ทีม Tabletop | `feat/F026-F027-reliability` | `server/providers/clarify-language.ts`, `server/providers/deepseek-changes.ts`, tests | — | unit ผ่าน · แก้เคสอังกฤษ→จีนจาก production ([F026](docs/features/F026-clarify-language.md)) |
| F024-T1 | repair escalation: ถ้า issue เดิมวนซ้ำ สั่งให้ลดความซับซ้อน (ตัด action/view ที่ทำให้พัง) | `review` | ทีม Tabletop | `feat/F024-repair-escalation` | `cloudflare/repair.ts`, `cloudflare/ai.ts`, tests | — | live: มังกรผ่าน attempt 3, มัดจำผ่าน attempt 2 ([F024](docs/features/F024-repair-escalation.md)) |
| F023-T1 | กู้ตารางเมื่อการ์ด canvas พัง: salvage view ที่ชั้น provider parse + domain validation, prompt บอกให้ omit view ที่เขียนไม่ได้ | `review` | ทีม Tabletop | `feat/F023-canvas-salvage` | `domain/table.ts`, `server/providers/deepseek-changes.ts`, tests | — | live: prompt เดิมผ่านรอบแรกหลังแก้ ([F023](docs/features/F023-canvas-salvage.md)) |
| F019-T1 | capability registry + panel "What this table can do" + `/api/capabilities.table` | `review` | ทีม Tabletop | `feat/F019-capabilities` | `shared/table-capabilities.ts`, `cloudflare/index.ts`, `ui/TableCanvasObjects.tsx`, tests | — | additive; unit + browser ([F019](docs/features/F019-table-capabilities.md)) |
| F001-T1 | ชุดข้อมูลการ์ด starter 3 โจทย์ | `review` | Claude Code | `feat/F001-start-page` | `src/tabletop/shared/starters.ts` (ใหม่) | — | |
| F001-T2 | หน้าเริ่มโต๊ะใหม่: คำถาม + การ์ด + ช่องพิมพ์ | `review` | Claude Code | `feat/F001-start-page` | `src/tabletop/ui/StartPrompt.tsx` (ใหม่), `TabletopApp.tsx`, CSS ใหม่ | T1, F004-T2 | hotspot `TabletopApp.tsx` · อยู่ที่ path `/new` |
| F001-T3 | ตรวจและเตรียม "ตัวอย่าง + กฎให้ตรวจ" ของแรงกับมวลและเกมโล่ | `todo` | — | — | `src/tabletop/domain/` (teaching, encounter) | — | spike ก่อน: ตอนนี้มีแค่ `invoice.sample` |
| F001-T4 | กดการ์ดแล้วสร้างโต๊ะชนิดนั้นและโหลดตัวอย่าง | `todo` | — | — | `client.ts`, `TabletopApp.tsx` | T2, T3 | |
| F001-T5 | Endpoint AI แนะนำ starter จากข้อความ (Worker) | `todo` | — | — | `cloudflare/starter-ai.ts` (ใหม่), `cloudflare/index.ts`, `cloudflare/contracts.ts`, `cloudflare/*.test.ts` | — | แตะงบ AI + consent ต้องมีเทสต์ด้านปฏิเสธ |
| F001-T6 | Node runtime ตอบ endpoint เดียวกันว่า AI ปิด | `todo` | — | — | `server/app.ts`, `server/*.test.ts` | T5 (contract) | |
| F001-T7 | ช่องพิมพ์เรียก T5 แล้วไฮไลต์การ์ดที่แนะนำ | `todo` | — | — | `StartPrompt.tsx`, `client.ts` | T2, T5 | |
| F001-T8 | แชทเป็น island ลอย | `review` | Claude Code | `feat/F001-T8-T9-chat-island` | `TableAssistant.tsx`, `assistant-calm.css`, `calm-workspace.css`, `TableSurface.tsx` | — | T8 + T9 คนเดียวทำ (ไฟล์เดียวกัน) |
| F001-T9 | แชทย่อเป็นวงกลมไอคอนดุ๊กดิ๊กเมื่อไม่มีคนพิมพ์ | `review` | Claude Code | `feat/F001-T8-T9-chat-island` | ไฟล์เดียวกับ T8 | T8 | ต้องรองรับ reduced motion |
| F001-T10 | ปรับ browser tests ตาม flow ใหม่ | `todo` | — | — | `tests/*.mjs` | T2, T4, T8 | แต่ละงานแก้เทสต์ของตัวเองได้ งานนี้เก็บส่วนที่เหลือ |
| F001-T11 | คู่มือผู้ใช้ + CHANGELOG | `todo` | — | — | `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | T4, T7, T9 | |
| CI004 | R1 browser test เปิด server ใหม่ทุก scenario แทนการรอ rate limit | `review` | JitrudeeDongdee (Claude) | `feat/CI004-r1-no-rate-wait` | `tests/tabletop-r1.mjs` | — | hotspot `tests/tabletop-r1.mjs` |
| F003-T2 | ออกแบบ + security review ลิงก์ใช้ซ้ำ ให้คนอนุมัติ | `todo` | — | — | `docs/features/F003-reusable-invite-link.md` | — | ไม่ใช่โค้ด |
| F003-T3 | Room: สถานะลิงก์ + เปิด/ปิด/สร้างใหม่ + redeem แบบใช้ซ้ำ | `review` | Claude Code | `feat/F003-T3-invite-link` | `cloudflare/room.ts`, `cloudflare/room-repository.ts`, `cloudflare/*.test.ts` | F003-T1, F003-T2 | |
| F003-T4 | Worker route + rate limit + Node เทียบเท่า | `todo` | — | — | `cloudflare/index.ts`, `server/app.ts`, `server/authority.ts` | F003-T3 | hotspot `cloudflare/index.ts` |
| F003-T5 | UI หน้าต่าง People: เอา AVAILABLE SEATS ออก แสดงคนในโต๊ะ + `N/7` + ลิงก์เชิญ + ปุ่มเอาออก + หน้าเข้าร่วม | `review` | Claude Code | `feat/F003-T5-people-dialog` | `TabletopApp.tsx` (`InviteDialog`), CSS | F003-T1, F003-T4, F004-T2 | hotspot `TabletopApp.tsx` |
| F003-T6 | คู่มือ + CHANGELOG + แก้ข้อความ "works once" | `review` | Claude Code | `feat/F003-T5-people-dialog` | `docs/USER_GUIDE_TH.md`, `CHANGELOG.md`, `TabletopApp.tsx` | F003-T5 | |
| F004-T1 | router เล็กใน client + parse path แบบ allowlist | `review` | Claude Code | `feat/F004-url-paths` | `src/tabletop/routes.ts` (ใหม่), `src/main.tsx` | — | |
| F004-T2 | TabletopApp ใช้ URL เป็นแหล่งความจริงของโต๊ะที่เปิด | `review` | Claude Code | `feat/F004-url-paths` | `TabletopApp.tsx` | F004-T1 | hotspot `TabletopApp.tsx` |
| F004-T3 | กลับ path เดิมหลังล็อกอิน + หน้าเปิดโต๊ะไม่ได้ | `review` | Claude Code | `feat/F004-url-paths` | `TabletopApp.tsx`, `src/tabletop/ui/account.tsx` | F004-T2 | |
| F004-T4 | Worker/Node ส่ง `index.html` ให้ path ลึก + asset โหลดได้ | `review` | Claude Code | `feat/F004-url-paths` | `server/app.ts`, `wrangler.jsonc`, tests | — | |
| F004-T5 | ปรับ browser tests + เอกสาร | `review` | Claude Code | `feat/F004-url-paths` | `tests/*.mjs`, `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | F004-T2 | |
| CI001 | ESLint ใน CI (ห้าม `any`/`@ts-ignore`) + pre-commit hook husky | `review` | JitrudeeDongdee (Claude) | `feat/CI001-eslint-husky` | `eslint.config.js` (ใหม่), `.husky/` (ใหม่), `package.json`, `package-lock.json`, `.github/workflows/validate.yml`, `scripts/check-public-files.mjs`, `.gitignore`, `CONTRIBUTING.md`, `AGENTS.md` | — | |
| CI002 | เคลียร์ ESLint warning แล้วเลื่อนกฎเป็น error | `todo` | — | — | ทั่ว repo, `eslint.config.js` | CI001 | แตกตามโฟลเดอร์ ระวัง hotspot |
| CI003 | ย้าย guard ของ workbench ให้ hook ไม่ถูกเรียกแบบมีเงื่อนไข | `review` | JitrudeeDongdee (Claude) | `fix/CI003-workbench-hooks` | `src/tabletop/ui/{Encounter,Invoice,Teaching}Workbench.tsx`, `eslint.config.js` | CI001 | บั๊กแฝง ดู spec ถัดไป ข้อ 7 |
| CI005 | PR/push เข้า `dev` รันเช็คเร็ว (ข้าม browser suites) · ชุดเต็มรันเฉพาะ release/`main`/Run workflow | `review` | Claude Code | `ci/CI005-fast-dev-checks` | `.github/workflows/validate.yml`, `AGENTS.md` §3 | — | ผู้ใช้ขอ: เช็คนานทุกครั้งที่เข้า dev |
| F007-T1 | ขยายการ์ดที่ใช้ตำแหน่งร่วม + ตำแหน่งเริ่มต้น + ลองส่งใหม่เมื่อชน | `review` | Claude Code | `feat/F007-shared-layout` | `src/tabletop/shared/canvas-layout-ids.ts` (ใหม่), `domain/canvas-layout.ts`, `ui/CanvasWorkspace.tsx`, `TabletopApp.tsx` (runCommand) | — | ชนกับ #30 ที่ `CanvasWorkspace.tsx` (prop `onEditRules`) เล็กน้อย |
| F022 | การ์ดคำถามจาก AI: เลือกได้หลายคำตอบ + ตัวเลือกที่ 4 พิมพ์คำตอบเอง แล้วกด Send answer | `review` | Claude Code | `feat/F020-multi-answer` | `src/tabletop/ui/ClarificationAnswers.tsx` (ใหม่), `clarification-answer.ts` (ใหม่), `useTableChat.tsx`, `table-chat.css`, `tests/generic-table-browser.mjs` | — | ไม่แตะ server/AI |
| F021 | พิมพ์ข้อความต่อได้ระหว่างรอร่างกฎ/คำตอบ (ช่องข้อความไม่ล็อก ปุ่มส่งยังรอ) | `review` | Claude Code | `fix/F019-type-while-drafting` | `src/tabletop/ui/TableChat.tsx` | — | |
| F020 | ร่างกฎล้มซ้ำเพราะ "Field bounds do not match its type": แยกข้อความตรวจ field เป็น 3 กรณีพร้อมชื่อ field + ใส่กฎลงคำสั่ง AI | `review` | Claude Code | `fix/F018-field-bounds` | `src/tabletop/domain/table.ts` (checkProgram), `server/providers/deepseek-changes.ts` (prompt), `table.test.ts` | — | พบจากข้อความ F016 บน staging |
| F034-T3 | คำขอร่างกฎ (`/model`) ของทุกคนเป็นการ์ดในแชท (เก็บ prompt, `GET /model`, poll ข้ามคน, การ์ดคนอื่นตอบคำถาม AI ไม่ได้) + สมาชิกเห็นการ์ด Rules ตอนมีแค่ร่าง + ตำแหน่งการ์ดแชท/Rules ร่วมกันทุกคน | `review` | JitrudeeDongdee (Claude) | `feat/F034-live-chat` | `cloudflare/room*.ts`, `client.ts`, `useTableChat.tsx`, `table-chat-state.ts`, `runtime/index.ts`, `canvas-layout*.ts` | — | T1 (#112), T2 (#115, #117) merge แล้ว |
| F038-T1 | server: คำตอบธรรมดาไม่ล้ม `STALE_WORKSPACE` เมื่อโต๊ะเปลี่ยนระหว่างสร้าง (proposal ยังเช็ค revision) | `done` (4.4.0) | lead (AI) | `feat/F038-parallel-requests` | `cloudflare/room.ts`, `cloudflare/room.test.ts` | — | |
| F038-T2 | client: Send ไม่บล็อกระหว่างรอ · ask ขนาน · draft เข้าคิวและเริ่มเองหลัง refresh | `done` (4.4.0) | lead (AI) | `feat/F038-parallel-requests` | `ui/useTableChat.tsx`, `ui/table-chat-state.ts`, tests | F038-T1 | hotspot `tests/generic-table-browser.mjs` |
| F038-T3 | คู่มือ + CHANGELOG | `done` (4.4.0) | lead (AI) | `feat/F038-parallel-requests` | `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | — | |
| F040-T1 | contract + zod + evaluator + validation ของ `motion` | `review` | lead (AI) | `feat/F040-scene-motion` | `shared/generative-contracts.ts`, `runtime/generative/{schema,evaluator,validation}.ts`, tests | — | |
| F040-T2 | UI: clock/วนลูป/ปุ่มหยุด/reduced motion | `review` | lead (AI) | `feat/F040-scene-motion` | `ui/GeneratedCanvasObjects.tsx`, `ui/scene-motion.ts`, `ui/generated-canvas.css`, tests | F040-T1 | hotspot `ui/GeneratedCanvasObjects.tsx` |
| F040-T3 | prompt guide + ตัวอย่างรถวิ่งวน + CHANGELOG | `review` | lead (AI) | `feat/F040-scene-motion` | `server/providers/table-schema-guide.ts`, `server/providers/deepseek-changes.ts`, `CHANGELOG.md`, `spec.md` | F040-T1 | |
| F041-T1 | แก้เพดาน response ของ assistant (raw SSE vs คำตอบ) + regression test | `review` | lead (AI) | `feat/F040-scene-motion` | `cloudflare/table-assistant.ts`, `cloudflare/table-assistant.test.ts` | — | |
| F035-T1 | โมเดลสิทธิ์: แค็ตตาล็อก permission ต่อชนิดโต๊ะ + role ตั้งต้นตาม case + role ที่สร้างเอง + การกำหนด role รายคน เก็บใน domain state (ไม่มี SQL migration) + ค่าเริ่มต้นเมื่อไม่กำหนด | `review` | JitrudeeDongdee (Claude) | `feat/F035-role-permissions` | `src/tabletop/shared/permissions.ts` (ใหม่), `shared/contracts.ts`, `domain/*` | F034-T1 | แทน `PERMISSION_POLICY` ใน WIP 753635a |
| F035-T2 | บังคับสิทธิ์ที่ server ทุกจุด: คำสั่ง domain, เชิญ/เอาออก/เปลี่ยนชื่อ/อนุมัติ, `/model`, ลิงก์เชิญ, AI · ลบ/รีเซ็ตโต๊ะ = เจ้าของเท่านั้นเสมอ · เอาเจ้าของออกไม่ได้ | `review` | JitrudeeDongdee (Claude) | `feat/F035-role-permissions` | `server/authority.ts`, `cloudflare/room.ts`, `cloudflare/ai.ts`, `cloudflare/table-assistant.ts`, `domain/{table,evolution,teaching,encounter,invoice}.ts` | F035-T1 | hotspot `cloudflare/room.ts` |
| F035-T3 | คำสั่งจัดการ role: สร้าง/แก้/ลบ role, กำหนด role ให้คน (ต้องมี `roles.manage`, ให้สิทธิ์เกินตัวเองไม่ได้, แตะ role เจ้าของไม่ได้) | `review` | JitrudeeDongdee (Claude) | `feat/F035-role-permissions` | `domain/access.ts` (ใหม่), `server/authority.ts` (`publicCommands`) | F035-T1 | |
| F035-T4 | UI: หน้าต่าง People เลือก role รายคน + หน้าจัดการ role (เลือกจาก role ตั้งต้น หรือสร้างเองด้วยการติ๊กสิทธิ์) + ซ่อนปุ่มตามสิทธิ์จริง | `review` | JitrudeeDongdee (Claude) | `feat/F035-role-permissions` | `TabletopApp.tsx` (`InviteDialog`), `ui/RoleSettings.tsx` (ใหม่), `ui/*` ที่เช็ค owner | F035-T3 | hotspot `TabletopApp.tsx` |
| F035-T5 | role ตั้งต้นของ case อื่น: บทเรียน (ครู/ผู้เรียน), เกม encounter (DM/ผู้เล่น), invoice · การกระทำในเกมที่ผูกที่นั่ง (ตอบคำถาม, shield) คงผูกที่นั่งเดิม | `review` | JitrudeeDongdee (Claude) | `feat/F035-role-permissions` | `shared/permissions.ts`, `domain/{teaching,encounter,invoice}.ts` | F035-T2 | |
| F035-T6 | เทสต์ (subagent) + คู่มือ + CHANGELOG | `review` | JitrudeeDongdee (Claude) + subagent | `feat/F035-role-permissions` | tests, `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | F035-T4 | ทุกสิทธิ์ต้องมีเทสต์ด้านถูกปฏิเสธ |
