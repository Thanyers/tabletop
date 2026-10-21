# PLAN.md — กระดานงานของทีม

ใช้ไฟล์นี้ดูว่า **ใครกำลังทำอะไร ไฟล์ไหน** ก่อนหยิบงาน เพื่อไม่ให้สองคน (หรือสอง AI) แก้เรื่องเดียวกันพร้อมกัน
รายละเอียดของแต่ละฟีเจอร์อยู่ใน [`docs/features/`](docs/features/) ส่วนสถานะระบบที่เสร็จแล้วอยู่ใน [`spec.md`](spec.md)

## กติกา

1. **ก่อนหยิบงาน:** ดูตารางด้านล่าง แล้วรัน `gh pr list -R Thanyers/tabletop --state open` ว่าไม่มี PR ที่ชื่อขึ้นต้นด้วย ID เดียวกัน
2. **จองงาน:** แตก branch จาก `dev` (`feat/<ID>-<ชื่อสั้น>`) แก้แถวของงานนั้นในไฟล์นี้ (สถานะ `doing`, ผู้รับผิดชอบ, branch) แล้ว **เปิด draft PR ทันที** ชื่อ PR ขึ้นต้นด้วย ID เช่น `F001-T4: ...` · draft PR คือการจองที่ทุกคนเห็น
3. **แก้เฉพาะแถวของตัวเอง** อย่าจัดรูปแบบหรือเรียงตารางใหม่ จะได้ไม่ชนกับคนอื่น
4. **ดูคอลัมน์ "พื้นที่ที่แตะ":** ถ้างานที่ `doing` อยู่แตะไฟล์เดียวกับงานที่จะหยิบ ให้รอ หรือคุยกันก่อน · งานที่มี "ต้องรอ" ห้ามเริ่มจนงานนั้น `done`
5. **จบงาน:** PR พร้อม review → เปลี่ยนสถานะเป็น `review` · คน merge แล้ว → `done` (แก้ใน PR ถัดไปของคุณได้)
6. งานใหม่ที่ยังไม่มีใครจอง ให้เพิ่มไว้ใน feature doc ก่อน แล้วค่อยเพิ่มแถวที่นี่

**สถานะ:** `todo` · `doing` · `review` · `done` · `blocked` (ใส่เหตุผลในคอลัมน์หมายเหตุ)

## จุดที่ชนบ่อย (hotspots)

ไฟล์เหล่านี้หลายงานแตะพร้อมกัน ให้แก้เท่าที่จำเป็นและ merge `dev` เข้า branch ตัวเองบ่อย ๆ:
`src/tabletop/TabletopApp.tsx` · `tests/generic-table-browser.mjs` · `tests/cloudflare-browser.mjs` · `tests/tabletop-r1.mjs` · `cloudflare/index.ts` · `CHANGELOG.md` (เพิ่มบรรทัดใต้ `Unreleased` เท่านั้น) · `spec.md`

## ฟีเจอร์

| ID | ฟีเจอร์ | สถานะ | เอกสาร |
| --- | --- | --- | --- |
| F001 | เริ่มโต๊ะใหม่ด้วยคำถาม + การ์ดเดโม + AI ช่วยเลือก + แชทแบบ island | `doing` (T1–T2 review) | [F001](docs/features/F001-guided-table-start.md) |
| F002 | ตั้งชื่อโต๊ะที่แถบด้านบน | `done` (#29 → dev) | [F002](docs/features/F002-rename-table.md) |
| F003 | ลิงก์เชิญเข้าโต๊ะแบบใช้ซ้ำได้ + เอาสมาชิกออก | `todo` (ต้อง security review ก่อน T3) | [F003](docs/features/F003-reusable-invite-link.md) |
| F004 | แยก URL path ให้แต่ละหน้า (`/`, `/new`, `/t/<id>`, `/join`) | `review` | [F004](docs/features/F004-url-paths.md) |
| F005 | สร้างภาพ สูตร และเครื่องมือใหม่บน Canvas พร้อม shared layout | `done` (#24 → dev) | [F005](docs/features/F005-generative-canvas.md) |
| F006 | โต๊ะข้อมูลเริ่มจากแชท: แชทแถวเดียวกึ่งกลางล่าง · โต๊ะว่างไม่มีการ์ด · คำตอบเป็นการ์ด | `done` (#30 → dev; T7 เอกสารส่งต่อแยก) | [F006](docs/features/F006-chat-first-table.md) |
| F007 | ตำแหน่งการ์ดเป็นของทั้งโต๊ะ ทุกคนเห็นเหมือนกัน | `review` | [F007](docs/features/F007-shared-card-layout.md) |
| F012 | AI ถามกลับแทนการร่างกฎเมื่อโจทย์ยังไม่พอ | `done` | [F012](docs/features/F012-ai-clarifying-questions.md) |

## งาน

| ID | งาน | สถานะ | ผู้รับผิดชอบ | branch / PR | พื้นที่ที่แตะ | ต้องรอ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F017-T1 | คอลัมน์คำนวณ (computed columns) ด้วย AST เดิม ประเมินตอน projection ไม่เก็บลง records | `done` | ทีม Tabletop | `feat/F017-computed-columns` · #66 merged | `shared/table-contracts.ts`, `shared/computed-columns.ts`, `domain/table.ts`, `ui/TableCanvasObjects.tsx`, tests | — | encoding: `TableState.computedColumns` (MINOR) · unit 432, browser ผ่าน; รอขึ้น hosted ใน release ถัดไป ([F017](docs/features/F017-computed-columns.md)) |
| F018-T1 | รักษา canvas views ตอน evolve (server-side merge + validate ต่อ view) | `done` | ทีม Tabletop | `feat/F018-preserve-views` · #71 merged | `runtime/generative/preserve.ts`, `domain/table.ts`, tests | — | unit 440 + CI browser ผ่าน; รอขึ้น hosted ใน release ถัดไป ([F018](docs/features/F018-preserve-canvas-views.md)) |
| F027-T1 | reject บอกเหตุผลเชิงโครงสร้าง: เติม hint "join ข้าม collection ยังไม่รองรับ" เมื่อ reason ชี้ cross-record/cross-collection | `review` | ทีม Tabletop | `feat/F026-F027-reliability` | `cloudflare/model-failure.ts`, tests | — | unit ผ่าน ([F027](docs/features/F027-structural-reject-hint.md)) |
| F031-T1 | thinking generation + output caps 32K + deadline 120s + compact schema guide + parse diagnostics | `review` | ทีม Tabletop | `feat/F031-thinking-generation` | `server/providers/deepseek-changes.ts`, `cloudflare/{ai,billing,room}.ts`, `server/providers/table-schema-guide.ts`, `ui/*`, tests | — | เกณฑ์: matched ≥18/20, first-attempt ≥50%, 0 length-truncation ([F031](docs/features/F031-thinking-generation.md)) |
| F030-T1 | corpus หลายรอบ (`TABLE_CORPUS_ROUNDS` 1–5) + stability ต่อเคส | `done` | ทีม Tabletop | `feat/F030-corpus-rounds` | `server/corpus-success-rate.test.ts`, docs | — | 3 รอบ: 29/30, reject 0, join draft 100% ([F030](docs/features/F030-corpus-rounds.md)) |
| F029-T1 | golden corpus 10 โจทย์ + วัด draft/clarify/reject rate (manual, ไม่ผูก CI) | `review` | ทีม Tabletop | `feat/F029-success-corpus` | `tests/corpus/table-prompts.json`, `server/corpus-success-rate.test.ts` | — | baseline 9/10 ([F029](docs/features/F029-golden-corpus.md)) |
| F028-T1 | fallback ตารางขั้นต่ำ: รอบที่ 4 ขอ 1 collection ≤4 fields ไม่มี canvas/join แล้วค่อย reject | `review` | ทีม Tabletop | `feat/F028-minimal-fallback` | `cloudflare/ai.ts`, `cloudflare/repair.ts`, tests | — | ลด reject จากเคส join ([F028](docs/features/F028-minimal-fallback.md)) |
| F025-T1 | แก้ refresh race: draft พร้อมแต่ขึ้น "The table could not refresh: The table changed" — เก็บ projection ล่าสุด + backoff แล้ว apply แทนการโยน error | `review` | ทีม Tabletop | `feat/F025-refresh-race` | `TabletopApp.tsx`, `ui/table-chat-state.ts`, tests | — | เจอ 1/10 บน production ([F025](docs/features/F025-draft-refresh-race.md)) |
| F026-T1 | บังคับภาษาคำถาม clarify ให้ตรงภาษาคำขอ (ตรวจอักษร + repair 1 รอบ) | `review` | ทีม Tabletop | `feat/F026-F027-reliability` | `server/providers/clarify-language.ts`, `server/providers/deepseek-changes.ts`, tests | — | unit ผ่าน · แก้เคสอังกฤษ→จีนจาก production ([F026](docs/features/F026-clarify-language.md)) |
| F024-T1 | repair escalation: ถ้า issue เดิมวนซ้ำ สั่งให้ลดความซับซ้อน (ตัด action/view ที่ทำให้พัง) | `review` | ทีม Tabletop | `feat/F024-repair-escalation` | `cloudflare/repair.ts`, `cloudflare/ai.ts`, tests | — | live: มังกรผ่าน attempt 3, มัดจำผ่าน attempt 2 ([F024](docs/features/F024-repair-escalation.md)) |
| F023-T1 | กู้ตารางเมื่อการ์ด canvas พัง: salvage view ที่ชั้น provider parse + domain validation, prompt บอกให้ omit view ที่เขียนไม่ได้ | `review` | ทีม Tabletop | `feat/F023-canvas-salvage` | `domain/table.ts`, `server/providers/deepseek-changes.ts`, tests | — | live: prompt เดิมผ่านรอบแรกหลังแก้ ([F023](docs/features/F023-canvas-salvage.md)) |
| F019-T1 | capability registry + panel "What this table can do" + `/api/capabilities.table` | `review` | ทีม Tabletop | `feat/F019-capabilities` | `shared/table-capabilities.ts`, `cloudflare/index.ts`, `ui/TableCanvasObjects.tsx`, tests | — | additive; unit + browser ([F019](docs/features/F019-table-capabilities.md)) |
| F015-T1 | นำแถวข้อมูลเข้า collection โดยตรง (CSV → records) แบบ deterministic ไม่เรียก AI | `done` | ทีม Tabletop | `feat/F015-import-rows` · #63 merged | `src/tabletop/domain/table.ts`, `server/authority.ts`, `ui/TableCanvasObjects.tsx`, `ui/table-row-import.ts`, tests | — | backend + UI + browser check ผ่าน; รอขึ้น hosted ใน release ถัดไป ([F015](docs/features/F015-table-row-import.md)) |
| F010-T1 | ต่อเติมโต๊ะจากแชท, เพิ่ม record ผ่านปุ่มจริง, ลดขั้นตอนกฎและแก้ card overflow | `done` | Codex | `fix/F010-canvas-evolution` (merged #42) | table interpreter/contracts, AI prompts/chat routing, Canvas sizing/CSS/review UI, focused tests | — | PR #42; focused unit 67 + assistant 10; browser Invoice 10 checks; AI จริงสร้าง/ใช้/ต่อเติม/กลับมาเล่นต่อได้ ดู docs/features/F010-canvas-evolution.md; ยังไม่ deploy |
| R200 | Release2.0.0: stagingสองบัญชี → main/tag → finalstaging → production | `done` | Codex | `release/2.0.0` · #33 merged | CHANGELOG, runtime bugfix, spec, release evidence/docs | F005/F006/F007 merged | mainCIผ่านก่อนannotatedtag; samebuildstaging/prodผ่าน; ไม่มีSQL/secret/งบใหม่; docs/RELEASE_2_0_ACCEPTANCE.md |
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
| F011 | สถานะรอ AI บนการ์ดแชท: ไอคอน Sparkles มีวงแหวนหมุน + จุดเด้ง + shimmer และจัดข้อความไว้กลางการ์ด | `done` | JitrudeeDongdee (Claude) | `feat/F011-chat-loading-motion` · #45 merged | `src/tabletop/ui/useTableChat.tsx`, `CanvasWorkspace.tsx`, `table-chat.css` | — | รองรับ reduced motion |
| F002-T1 | คำสั่ง `workspace.rename` (เจ้าของ, 1–100 ตัวอักษร) | `done` | Claude Code · Codex รวมทดสอบ | `feat/F002-rename-table` · #29 merged | `src/tabletop/domain/`, `server/authority.ts`, `src/tabletop/shared/contracts.ts` | — | รวมกับ F005 ผ่าน CI ที่ 743ff27 |
| F002-T2 | Room/Node เก็บชื่อ + My tables แสดงชื่อใหม่ | `done` | Claude Code · Codex รวมทดสอบ | `feat/F002-rename-table` · #29 merged | `cloudflare/room.ts`, `cloudflare/room-repository.ts`, `cloudflare/index.ts`, `server/repository.ts` | F002-T1 | |
| F002-T3 | UI แก้ชื่อที่แถบด้านบน | `done` | Claude Code · Codex รวมทดสอบ | `feat/F002-rename-table` · #29 merged | `TabletopApp.tsx`, CSS | F002-T2 | สมาชิกเห็นชื่อร่วมกัน |
| F002-T4 | คู่มือ + CHANGELOG | `done` | Claude Code · Codex รวมทดสอบ | `feat/F002-rename-table` · #29 merged | `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | F002-T3 | |
| F003-T1 | เอาสมาชิกออก (เจ้าของ) | `done` | Claude Code | `feat/F003-T1-remove-member` | `server/authority.ts`, `cloudflare/room.ts`, `cloudflare/room-repository.ts`, `TabletopApp.tsx` | — | ต้องเสร็จก่อนเปิดลิงก์ใช้ซ้ำ · ชนกับ F002-T2 |
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
| F005-T1 | Generative runtime, views, private trial, layout, AI repair/memory และ acceptance | `done` | Codex | `feat/F005-generative-canvas` · [PR #24](https://github.com/Thanyers/tabletop/pull/24) merged | `src/tabletop/{shared,domain,runtime,ui}/`, `server/`, `cloudflare/`, tests, docs, workflow | — | post-merge CI ที่ f0be463 ผ่าน: unit 355, CF 71, browser 7+22, generated 4 เรื่อง; AI จริง 3 เรื่องผ่านใน local acceptance; ยังไม่ deploy |
| CI001 | ESLint ใน CI (ห้าม `any`/`@ts-ignore`) + pre-commit hook husky | `review` | JitrudeeDongdee (Claude) | `feat/CI001-eslint-husky` | `eslint.config.js` (ใหม่), `.husky/` (ใหม่), `package.json`, `package-lock.json`, `.github/workflows/validate.yml`, `scripts/check-public-files.mjs`, `.gitignore`, `CONTRIBUTING.md`, `AGENTS.md` | — | |
| CI002 | เคลียร์ ESLint warning แล้วเลื่อนกฎเป็น error | `todo` | — | — | ทั่ว repo, `eslint.config.js` | CI001 | แตกตามโฟลเดอร์ ระวัง hotspot |
| CI003 | ย้าย guard ของ workbench ให้ hook ไม่ถูกเรียกแบบมีเงื่อนไข | `review` | JitrudeeDongdee (Claude) | `fix/CI003-workbench-hooks` | `src/tabletop/ui/{Encounter,Invoice,Teaching}Workbench.tsx`, `eslint.config.js` | CI001 | บั๊กแฝง ดู spec ถัดไป ข้อ 7 |
| CD001 | merge release เข้า `main` แล้ว deploy staging → smoke → production → smoke อัตโนมัติ | `done` | Claude Code | `ci/CD001-auto-deploy` | `.github/workflows/release-deploy.yml` (ใหม่), `.github/scripts/d1-migrate.sh` (ใหม่), `server/release-deploy.ts` (ใหม่), `AGENTS.md` §5–8, `docs/TEAM_HANDOFF_TH.md`, `docs/DEPLOYMENTS.md` | — | ผู้ใช้เลือก prod อัตโนมัติ + migration อัตโนมัติ; ต้องตั้ง secret ก่อนใช้ |
| F006-T1 | component `TableChat` แถวเดียว ขยาย 5 แถว + คลิปหนีบ + แถบยินยอม | `done` | Codex รับช่วงจากทีม | `feat/F006-chat-first` · #30 | `src/tabletop/ui/TableChat.tsx`, `table-chat.css`, `table-chat-consent.ts` | — | ผู้ใช้มอบหมายให้ต่อให้ครบและทดสอบรวม #24/#29 |
| F006-T2 | ซ่อนการ์ด Files/Rules เมื่อยังไม่มีของ | `done` | Codex | `feat/F006-chat-first` · #30 | `src/tabletop/runtime/index.ts`, `TableCanvasObjects.tsx` | #24 merged | |
| F006-T3 | ต่อ `TableChat` แทน `TableAssistant` ในโต๊ะข้อมูล | `done` | Codex | `feat/F006-chat-first` · #30 | `TableSurface.tsx`, `TabletopApp.tsx` | F006-T1 | คง prompt-only generation และการแก้กฎหลังเล่นจาก F005 |
| F006-T4 | คำตอบแชทเป็นการ์ดบน Canvas + Confirm action | `done` | Codex | `feat/F006-chat-first` · #30 | `CanvasWorkspace.tsx`, `TableCanvasObjects.tsx` | F006-T3 | ประวัติและการ์ดยังแยกตามผู้ถาม |
| F006-T5 | ย้าย browser tests ของ setup + chat ไปใช้แชทใหม่ | `done` | ทีมเริ่ม · Codex รับช่วงและรวมทดสอบตามคำสั่งผู้ใช้ | `feat/F006-chat-first` · #30 | `tests/generic-table-browser.mjs`, `tests/cloudflare-browser.mjs`, `tests/generative-canvas-browser.mjs` | F006-T3 | CI ก่อนและหลัง merge ผ่าน Node 7 / Worker 25 / generated 4 เรื่อง |
| F006-T6 | คู่มือ + CHANGELOG | `done` | Codex | `feat/F006-chat-first` · #30 | `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | F006-T4 | |
| F006-T7 | READMEและHandoffหลังรวมงานทีม | `done` | Codex | #32 merged; R200releasehandoff | README, TEAM_HANDOFF_TH, DEPLOYMENTS, spec, acceptance | #30 merged | ตรวจCI, hostedสองบัญชี, provenance, ขอบเขตlocalchatและหลักฐานdeploy2.0 |
| F007-T1 | ขยายการ์ดที่ใช้ตำแหน่งร่วม + ตำแหน่งเริ่มต้น + ลองส่งใหม่เมื่อชน | `review` | Claude Code | `feat/F007-shared-layout` | `src/tabletop/shared/canvas-layout-ids.ts` (ใหม่), `domain/canvas-layout.ts`, `ui/CanvasWorkspace.tsx`, `TabletopApp.tsx` (runCommand) | — | ชนกับ #30 ที่ `CanvasWorkspace.tsx` (prop `onEditRules`) เล็กน้อย |
| F008-T1 | ไฟล์บนโต๊ะเห็นได้และเพิ่มได้ทุกคนที่ถูกเชิญ (ลบเฉพาะเจ้าของ) + การ์ด Files ตำแหน่งร่วม | `done` | Claude Code | `feat/F008-shared-files` | `domain/projections.ts`, `runtime/index.ts`, `canvas-layout*.ts`, `TableCanvasObjects.tsx`, `TableChat.tsx`, `table-chat-consent.ts`, `AIProposal.tsx`, tests, docs | — | [F008](docs/features/F008-shared-table-files.md) |
| F009-T1 | เห็นเมาส์ของแต่ละคนพร้อมชื่อบน Canvas (live cursors) | `done` | Claude Code | `feat/F009-live-cursors` | `src/tabletop/shared/cursor-protocol.ts` (ใหม่), `ui/live-cursors.tsx` (ใหม่), `cloudflare/room.ts` (webSocketMessage), `server/app.ts` (socket), `client.ts` (subscribe), `CanvasWorkspace.tsx`, `TabletopApp.tsx`, tests | — | [F009](docs/features/F009-live-cursors.md) · ชน F008 ที่ PLAN/CHANGELOG/generic-table-browser.mjs เล็กน้อย |
| F013 | ขอความยินยอมส่ง AI ครั้งเดียวต่อโต๊ะ (ต่อ epoch ต่อคน) จำไว้ในเบราว์เซอร์ | `done` | JitrudeeDongdee (Claude) | `feat/F010-ai-consent-once` · #44 merged | `src/tabletop/ui/table-chat-consent.ts`, `TableChat.tsx`, `tests/generic-table-browser.mjs`, `tests/generative-canvas-browser.mjs`, `tests/cloudflare-browser.mjs`, `docs/GENERIC_TABLE_DESIGN.md` | — | ID F010 ถูกใช้แล้วโดย #42 จึงใช้ F013 แต่ชื่อ branch คงเดิม |
| F014 | การ์ดบน Canvas ลง grid 4px + responsive: padding การ์ดแชท/AI proposal, เลิกบังคับความสูง, กฎจอ ≤760px ที่ถูกทับ | `done` | JitrudeeDongdee (Claude) | `feat/F014-canvas-card-layout` · #46 merged | `src/tabletop/ui/calm-workspace.css` | — | CSS อย่างเดียว |
| F016 | แสดงสาเหตุจริงเมื่อร่างกฎจาก AI ไม่ผ่านการตรวจ | `done` | Claude Code | `feat/F016-validation-reasons` | `cloudflare/model-failure.ts` (ใหม่), `cloudflare/ai.ts`, `cloudflare/room.ts`, `cloudflare/room-repository.ts`, tests | — | [F016](docs/features/F016-validation-reasons.md) |
| F022 | การ์ดคำถามจาก AI: เลือกได้หลายคำตอบ + ตัวเลือกที่ 4 พิมพ์คำตอบเอง แล้วกด Send answer | `review` | Claude Code | `feat/F020-multi-answer` | `src/tabletop/ui/ClarificationAnswers.tsx` (ใหม่), `clarification-answer.ts` (ใหม่), `useTableChat.tsx`, `table-chat.css`, `tests/generic-table-browser.mjs` | — | ไม่แตะ server/AI |
| F021 | พิมพ์ข้อความต่อได้ระหว่างรอร่างกฎ/คำตอบ (ช่องข้อความไม่ล็อก ปุ่มส่งยังรอ) | `review` | Claude Code | `fix/F019-type-while-drafting` | `src/tabletop/ui/TableChat.tsx` | — | |
| F020 | ร่างกฎล้มซ้ำเพราะ "Field bounds do not match its type": แยกข้อความตรวจ field เป็น 3 กรณีพร้อมชื่อ field + ใส่กฎลงคำสั่ง AI | `review` | Claude Code | `fix/F018-field-bounds` | `src/tabletop/domain/table.ts` (checkProgram), `server/providers/deepseek-changes.ts` (prompt), `table.test.ts` | — | พบจากข้อความ F016 บน staging |
| F012 | AI ถามกลับเป็นคำถามเดียว + ตัวเลือก 3 ข้อแทนการร่างกฎเมื่อโจทย์ไม่พอ | `done` | JitrudeeDongdee (Claude) | `feat/F012-ai-clarifying-questions` | `server/providers/deepseek-changes.ts`, `cloudflare/ai.ts`, `cloudflare/room.ts`, `src/tabletop/client.ts`, `useTableChat.tsx`, `table-chat.css` | — | hotspot `cloudflare/room.ts` · [F012](docs/features/F012-ai-clarifying-questions.md) · PR #55 |
