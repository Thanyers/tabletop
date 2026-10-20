# spec.md — Tabletop

แหล่งความจริงของ **สถานะงาน** โปรเจกต์นี้ (ไม่ใช่แชท) · อัปเดตทุกครั้งที่จบงาน ตามกติกาใน [CLAUDE.md](CLAUDE.md)
รายละเอียดเชิงลึกอยู่ในเอกสารเจ้าของเรื่อง — ไฟล์นี้สรุปและลิงก์ ไม่คัดลอกซ้ำ

อัปเดตล่าสุด: 2026-10-20

## ผลิตภัณฑ์

Canvas ร่วมกันสำหรับสร้างงานหรือเกมจากข้อมูลและกติกา: ผู้ใช้นำไฟล์ข้อความเข้า → AI ร่างตาราง/กฎ/ปุ่มการกระทำ → คนตรวจ
*Simulate → Validate → Approve → Activate* → เชิญคนอื่นมาเล่นบนสถานะเดียวกัน ห้องเป็นหน่วยบันทึกถาวร

- คู่มือผู้ใช้: [docs/USER_GUIDE_TH.md](docs/USER_GUIDE_TH.md)
- ภาพรวมระบบและจุดเริ่มในโค้ด: [docs/TEAM_HANDOFF_TH.md](docs/TEAM_HANDOFF_TH.md)
- ดัชนีเอกสารทั้งหมด: [docs/README.md](docs/README.md)

## สถาปัตยกรรม (สรุป)

| ส่วน | ที่อยู่ในโค้ด | หน้าที่ |
| --- | --- | --- |
| React Canvas | `src/tabletop/` | แสดง projection ตามสิทธิ์ ส่งคำสั่ง — ไม่ใช่ผู้ตัดสิน |
| Domain / interpreter | `src/tabletop/domain/`, `src/tabletop/shared/` | กฎแบบข้อมูล deterministic, ไม่รัน JS ที่ AI เขียน |
| Authority | `server/authority.ts` | ตรวจ role/seat/turn/revision แล้ว commit แบบ atomic |
| Cloudflare Worker + D1 | `cloudflare/index.ts`, `cloudflare/auth.ts` | Google OIDC, session, CSRF, ดัชนี My tables |
| Room DO (SQLite) | `cloudflare/room.ts`, `room-repository.ts` | state/membership/receipts/events ต่อห้อง + WebSocket |
| Billing DO + AI | `cloudflare/billing.ts`, `cloudflare/ai.ts` | จองงบก่อนเรียก DeepSeek, consent, structured output |
| Node local runtime | `server/` | PGlite + guest session, AI ปิด (ใช้พัฒนา ไม่ใช่ production) |

ขอบเขต contract: [GENERIC_TABLE_DESIGN](docs/GENERIC_TABLE_DESIGN.md) · auth/storage: [R1_ARCHITECTURE](docs/R1_ARCHITECTURE.md) · design system: [design.md](design.md)

## สถานะปัจจุบัน

- **Release2.0.0 ส่งแล้ว:** maind93620d, annotated tagv2.0.0, [PR#33](https://github.com/Thanyers/tabletop/pull/33), [mainCI](https://github.com/Thanyers/tabletop/actions/runs/39439056507); staging/production buildเดียวกัน135assetsและ2Worker modulesตรงกัน ไม่มีSQL/secret/binding/งบใหม่ ดู[Deployment](docs/DEPLOYMENTS.md)และ[Releaseacceptance](docs/RELEASE_2_0_ACCEPTANCE.md)
- **R200 เล่นจริงและแก้ก่อนปล่อย:** สองGoogle accountsเล่นคาเฟ่3/8/Remaining0และน้ำ65/Red20/Blue15รวม100; private trial, activation, privacy, shared drag, resumeและread-onlyrejection/restoreผ่าน บั๊กformadvanceTurnpreviewล็อกsubmitแก้ด้วยcommittedcontrolbindingsและfail-closedguard; RED/GREENพร้อมreview CI376unit/71CF/7Node/25Worker/4generatedผ่าน ขอบเขตSHAแต่ละขั้นและSKIPPEDอยู่ในReleaseacceptance

- **README / Handoff หลังรวมทีม:** [PR #32](https://github.com/Thanyers/tabletop/pull/32) อัปเดตเรื่องเล่าหน้าหลัก ความสามารถที่ merge แล้ว วิธีเล่น งานทีม/จุดรวมแก้ และสิ่งที่ต้องตัดสินใจก่อน release; ตรวจลิงก์/ภาพและ publication scan บน Node `22.23.2` โดยไม่เปลี่ยน runtime · ตรวจ public endpoints 8 รายการของ production/staging เมื่อ 20 ต.ค. 19:36 น. พบทั้งคู่ยังเป็น `1.0.0` / `ce2c50e`, health/readiness ผ่านและ AI เปิด; ไม่ใช่การเล่นสองบัญชีหรือ deploy ใหม่
- **F006 แชทบน Canvas — merge เข้า `dev` แล้ว:** [PR #30](https://github.com/Thanyers/tabletop/pull/30), merge `ce6d69b` บนฐาน F005 + F002 + F007; Canvas ว่างก่อนมีเนื้อหา, ช่องแชทห้าแถว, การ์ดคำตอบส่วนตัว, Rules → Edit rules และ recovery พร้อม shared layout ที่รองรับการ์ดใหม่/ข้ามห้องโดยไม่ล็อกแชท · [CI ก่อน merge](https://github.com/Thanyers/tabletop/actions/runs/39420499206) และ [หลัง merge](https://github.com/Thanyers/tabletop/actions/runs/39421576811) ผ่าน Node `22.23.2`: unit 376, Cloudflare 71, browser Node 7 / Worker 25, generated 4 เรื่อง/8 คำขอจำลอง; build/dry-run/secret scan ผ่าน, lint 0 errors / 101 warnings · ดู [ผลตรวจและขอบเขต AI จริง 6 คำขอ](docs/features/F006-chat-first-table.md#ผลตรวจรุ่นรวม); ส่งในrelease2.0.0แล้ว (ดูหลักฐานreleaseล่าสุด)
- **F005 Generative Canvas — merge เข้า `dev` แล้ว:** [PR #24](https://github.com/Thanyers/tabletop/pull/24), merge `f0be463` · bounded expressions, scene/chart/metric/controls, ทดลองร่างส่วนตัว, shared semantic layout และ AI repair/การค้นบทสนทนาแบบจำกัด · post-merge [CI 39402734458](https://github.com/Thanyers/tabletop/actions/runs/39402734458) ผ่านบน Node `22.23.2`: unit 355, Cloudflare 71, browser Node 7 / Worker 22, generated 4 เรื่อง/8 drafts · AI จริงสามเรื่องผ่านใน disposable local acceptance; ขอบเขตอยู่ใน [acceptance](docs/GENERATIVE_CANVAS_ACCEPTANCE.md); ส่งในrelease2.0.0แล้ว (ดูหลักฐานreleaseล่าสุด)
- **Research/design ต้นทาง:** [Generative Canvas plan](docs/GENERATIVE_CANVAS_PLAN_TH.md) + [primary-source research](docs/GENERATIVE_CANVAS_RESEARCH_2026-10-20.md) ครอบคลุมเป้าหมายระยะถัดไปด้วย; ขอบเขตที่ทำแล้วให้ยึด [runtime](docs/GENERATIVE_CANVAS_RUNTIME.md) ไม่ถือว่าทั้งแผนเป็นความสามารถที่ส่งแล้ว
- **Releaseล่าสุด:** v2.0.0 / d93620d ส่งstagingและproductionแล้ว; v1.1.0มีtagแต่ไม่เคยส่งhosted
- **Release ก่อนหน้า:** `v1.0.0` (`ce2c50e`) deploy แล้วทั้ง staging และ production
- **Branch:** main@d93620d=releasev2.0.0; devรับmainคืนผ่านPRก่อนอัปเดตhandoff สถานะงานสดดูGitHubและPLAN.md
- **Deploy:** sealedtaggedbuild2.0.0ใช้ร่วมstaging/prod; health/readiness/capabilities/versionผ่านและ135servedassetsพร้อม2Worker modulesตรงกัน AIเปิด/ไม่read-only; finalstagingresumeสองบัญชีผ่าน Productionไม่สร้างห้องหรือเรียกAIเพิ่ม ดูdocs/DEPLOYMENTS.md
- **F002 ตั้งชื่อโต๊ะ — merge เข้า `dev` แล้ว:** [PR #29](https://github.com/Thanyers/tabletop/pull/29), merge `637d7eb` · คงการตรวจสิทธิ์/revision และชื่อที่ตั้งเองมาก่อนชื่อกฎ · รวมกับ F005 แล้วตรวจ [CI 39403737540](https://github.com/Thanyers/tabletop/actions/runs/39403737540) ที่ `743ff27`: unit 357, Cloudflare 71, browser Node 7 / Worker 23, generated 4 เรื่อง/8 drafts, lint/build/dry-run ผ่านบน Node `22.23.2`; [post-merge CI 39404758390](https://github.com/Thanyers/tabletop/actions/runs/39404758390) ผ่านชุดเดียวกันแล้ว; ส่งในrelease2.0.0แล้ว (ดูหลักฐานreleaseล่าสุด)
- **F001 T8–T9 แชท island + ย่อเป็นวงกลม — merge เข้า `dev` แล้ว (#28):** ตรวจแล้ว: `npm test` 320/320, lint 0 error, build ผ่าน, `test:cloudflare` 65/65, `test:cloudflare:browser` 21/21 (ข้อใหม่: island กึ่งกลาง, ไม่ย่อเมื่อมีข้อความค้าง, ย่อเมื่อว่าง, ไอคอนนิ่งเมื่อ reduced motion, Enter กางและโฟกัส), `test:r1:browser` 7/7, ภาพหน้าจอ 1280/390 ไม่เลื่อนแนวนอน · Node v26.3.1
- **F001 T1–T2 หน้าเริ่ม `/new` — merge เข้า `dev` แล้ว (#25):** การ์ด 3 ใบ + ช่องพิมพ์ (สร้างโต๊ะข้อมูลว่างและเติมช่องร่างกฎ ยังไม่เรียก AI) + เริ่มโต๊ะว่าง · ตรวจแล้ว: `npm test` 319/319, typecheck/build ผ่าน, `test:cloudflare` 65/65, `test:cloudflare:browser` 20/20, `test:r1:browser` 7/7, ภาพหน้าจอ 1280 และ 390 ไม่มีเลื่อนแนวนอน · Node v26.3.1
- **F004 URL paths — merge เข้า `dev` แล้ว (#21):** `/`, `/t/<id>`, `/join#invite=...`, `/new`
- **Infra:** Cloudflare Workers Free + D1 + SQLite DO + Google OAuth + DeepSeek Flash · ไม่มี R2/Paid · เพดาน AI prod $1/วัน $10/เดือน, staging $0.20/$0.20
- **หลักฐานของ release `v1.0.0`:** unit/SQL 309, Cloudflare 65, Component Lab 7, browser acceptance ผ่าน ([DEPLOYMENTS](docs/DEPLOYMENTS.md#ผลตรวจ-release-ล่าสุด)); ผลของ F005 แยกไว้ด้านบน
- **R1 browser ไม่รอ rate limit (CI004, branch `feat/CI004-r1-no-rate-wait` → `dev`):** `tests/tabletop-r1.mjs` เปิด server (และ data dir) ใหม่ทุก scenario แทนการ sleep รอหน้าต่าง rate limit 1 นาที 2 ครั้ง · rate limit ของแอปไม่เปลี่ยน · ตรวจแล้ว (Node v26.3.1, `BROWSER_CHANNEL=chrome`): ก่อนแก้ 138 วินาที (sleep 49.6 + 51.1) → หลังแก้ 48–51 วินาที 7/7 ผ่าน 3 รอบติด · ตัวควบคุม: ใช้ server เดียวโดยไม่รอ → scenario encounter ได้ 429 `RATE_LIMITED` · CI เดิม step นี้ 129–134 วินาที
- **Local (2026-10-20, เครื่องนี้):** clone `main` @ `e8cb73e` แล้ว pull เป็น `48fb2bd` → `npm ci` (0 vulnerabilities) → `npm run build` ผ่าน → `npm start` เปิด `:4310` ได้ ใช้ Node v26.3.1 (ไม่ตรง CI 22.23.2) · `npm run test:cloudflare` 65/65 ผ่าน (room 28, auth 13, ai 9, table-assistant 8, billing 7) ตรงกับจำนวนใน CI · `test:cloudflare:browser` 16/16 ผ่าน (ใช้ `BROWSER_CHANNEL=chrome` หลัง `build:cloudflare`)
- **`/version` — [PR #10](https://github.com/Thanyers/tabletop/pull/10) merge เข้า `main` แล้ว (`9fbfdec`) และ deploy แล้วพร้อม PR #13:** `GET /version` → `{"version","sha","built_at"}` ทั้ง Worker และ Node อ่านจาก `dist/version.json` ที่ build เขียน · ตรวจแล้ว: `npm test` 314/314, `npm run build` ผ่าน, `test:cloudflare` 65/65, `build:cloudflare` dry run, `test:cloudflare:browser` 17/17 (มี check `/version`), curl `:4310/version` → 200 `no-store`, `check-public-files` + `check-client-secrets` ไม่มี finding
- **Lint + pre-commit (CI001, branch `feat/CI001-eslint-husky` → `dev`):** CI รัน `npm run lint` (ESLint 10 + typescript-eslint 8) · error: `no-explicit-any`, `ban-ts-comment`, `rules-of-hooks`, eslint-disable ที่ไม่ได้ใช้ และกฎ recommended ที่ไม่มีของเดิมค้าง · husky + lint-staged รัน `check-public-files` + eslint ไฟล์ที่ stage · ตรวจแล้ว (Node v26.3.1 ในเครื่อง, CI ใช้ 22.23.2): `npm ci --ignore-scripts` + `npm audit` 0 vulnerabilities, `npm run lint` 0 error / 125 warning, ไฟล์ทดลองที่มี `: any` + `@ts-ignore` → 2 error exit 1, `git commit` ไฟล์ที่มี `any` ถูก hook บล็อก, `npm test` 314/314, `npm run build` ผ่าน, `check-client-secrets` 0 finding, `test:cloudflare` 65/65, `build:cloudflare` dry run ผ่าน, Component Lab ผ่าน · ยังไม่ได้รัน browser acceptance (ไม่ได้แตะโค้ดแอป)
- **Workbench hooks (CI003, branch `fix/CI003-workbench-hooks`, ต่อจาก CI001):** `Encounter/Invoice/TeachingWorkbench` แยก guard ชนิดข้อมูลออกจาก body ทำให้ hook ถูกเรียกครบทุก render · เอาข้อยกเว้น `rules-of-hooks` ออกจาก `eslint.config.js` · ตรวจแล้ว (Node v26.3.1): `tsc -b` ผ่าน, `npm run lint` 0 error, `npm test` 314/314, `npm run build` ผ่าน, `BROWSER_CHANNEL=chrome npm run test:r1:browser` 7/7 (invoice, physics, encounter + ไม่มี JS error ใน 7 context) · ไม่มี DOM unit test (ยังไม่มี jsdom) ตัวกันถอยหลังคือกฎ lint
- **Spec-driven + CI/CD สำหรับ AI:** `AGENTS.md` (กติกากลางของ AI ทุกตัว) / `CLAUDE.md` / `spec.md` / `MEMORY.md` · [PR #11](https://github.com/Thanyers/tabletop/pull/11) branch `docs/spec-driven` → `dev` · ใน PR นี้ CONTRIBUTING เปลี่ยนเป็น branch จาก `dev` และ CI รัน push เข้า `dev` ด้วย

### ข้อจำกัดผลิตภัณฑ์ที่มีผล

- ไฟล์โต๊ะทั่วไป: UTF-8 CSV/JSON/TXT/MD, 32 KiB/ไฟล์, 4 ไฟล์, รวม 64 KiB · ไม่รับ PDF/ภาพ/ไบนารี
- AI context ของ candidate: สถานะปัจจุบัน + ≤6 คู่/16 KiB (สี่ช่วงล่าสุดและค้นได้อีกสองช่วงจาก 100 รายการของผู้ถาม/ห้อง/epoch เดียวกัน), table input ≤48,000 bytes และ provider request รวม ≤64,000 bytes, ≤500 assistant jobs/ห้อง · ยังไม่มีการสรุปความจำระยะยาวอัตโนมัติ
- ห้อง: เจ้าของ + สมาชิก ≤7 · invite ใช้ครั้งเดียว หมดอายุ 10 นาที
- เปลี่ยนโครงสร้างตารางระหว่างเล่นไม่ได้

### ยังไม่ได้พิสูจน์

มือถือ/สองอุปกรณ์จริง, load/soak, live budget-negative, กู้คืน D1 + Room + Billing ทั้งระบบ, automated a11y audit

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-20 | การบันทึก `canvas.layout` ไม่ตั้งหรือล้าง busy ของแชท/คำสั่งเล่น | ผังมีคิวและ revision แยก; การบันทึกตำแหน่งพื้นหลังต้องไม่ขัดการพิมพ์หรือเปิด consent และผลตอบรับช้าต้องไม่ปลดล็อกคำสั่งอื่น |
| 2026-10-20 | F005 ใช้ bounded AST สำหรับสูตรและพฤติกรรมใหม่บน React/SVG เดิม | ข้าม catalog เดิมได้โดยไม่เปิด host JavaScript/IO; action และผลลัพธ์ตรวจที่ authority ก่อน commit และร่างทดลองบนสำเนาส่วนตัว |
| 2026-10-20 | shared layout มี revision ของตัวเองและกล้องเป็นของแต่ละคน | การลากการ์ดไม่ทำให้คำสั่งเล่นหมดอายุ; เปิดการ์ดแล้วรอ geometry นิ่งก่อนเลื่อนกล้อง และการเลื่อน/ซูมของคนยกเลิก focus ที่ค้าง |
| 2026-10-20 | F005 ใช้ JSON state เดิม ไม่มี SQL migration หรือ binding ใหม่ | ห้องเก่ายังอ่านได้; ห้องที่บันทึก AST ใหม่ต้องใช้ compatible writer จึงต้องเสนอ MAJOR ตามกฎ rollback ก่อน release |
| 2026-10-20 | รอบพิสูจน์ Generative Canvas ต้องรวมการจัดวางการ์ดตามความสัมพันธ์และ custom behavior ที่ catalog เดิมทำไม่ได้ | ผู้ใช้รับทางเลือกเทคโนโลยีและขอ algorithm จัดวางที่เข้าใจง่าย/สร้างสรรค์; F005 ใช้ bounded AST พิสูจน์ส่วนนี้ ส่วน shared clock, code sandbox และ hidden evaluation ทั้งชุดยังอยู่ในแผน |
| 2026-10-20 | โปรเจกต์นี้ไม่ใช้ phak; ติดตามงานใน `spec.md` + GitHub PR | ผู้ใช้สั่ง — ทับกฎ global ใน [CLAUDE.md](CLAUDE.md) |
| 2026-10-20 | `CLAUDE.md` / `spec.md` / `MEMORY.md` ขึ้น repo public | ผู้ใช้สั่ง · ห้ามใส่ secret/ID/ข้อมูลผู้ใช้ตามกฎใน CLAUDE.md |
| 2026-10-20 | เอกสารผูกโค้ดอยู่ใน git ผ่าน PR; หลักฐานที่มีข้อมูลส่วนตัวอยู่ใน `test-results/` | ตรงกับ convention เดิมของ repo และ repo เป็น public |
| 2026-10-20 | `/version` อ่านจาก `version.json` ที่ build วางคู่ไฟล์เว็บ แทนการฉีดค่าตอน deploy | คำสั่ง deploy อยู่ในเครื่อง operator (ไม่อยู่ใน git) — วิธีนี้ไม่ต้องแก้คำสั่งนั้น แต่ config deploy ต้องมี `/version` ใน `run_worker_first` |
| 2026-10-20 | commit ที่ไม่มี tag `vX.Y.Z` ได้ version `0.0.0-dev`; ไม่อ่านเลขจาก `package.json` | กฎ global: git tag เป็นแหล่งเดียวของเลขเวอร์ชัน |
| 2026-10-20 | `dev` = branch รวมงาน, `main` = release เท่านั้น; `main` รับแค่ `release/*` และ `hotfix/*` | ผู้ใช้สั่ง · ตามกฎ Git Flow ใน global โดยใช้ชื่อ `dev` แทน `develop` |
| 2026-10-20 | กติกา CI/CD ของ AI ทุกตัวอยู่ใน `AGENTS.md`; `CLAUDE.md` เก็บแค่ส่วนเฉพาะ Claude | ผู้ใช้สั่งให้ AI ตัวอื่นทำงานแบบเดียวกัน · `AGENTS.md` เป็นชื่อที่ Codex/Cursor ฯลฯ อ่าน |
| 2026-10-20 | ตั้ง branch protection ไม่ได้จากบัญชีนี้ (push ได้ ไม่ใช่ admin) — เตรียมคำสั่ง ruleset ไว้ใน AGENTS.md §9 | เจ้าของ repo ต้องรัน |
| 2026-10-20 | release แรกคือ `v1.0.0` | ผู้ใช้เคาะ · production เปิดให้ผู้ใช้จริงแล้ว และตามกฎ global release แรกของ production คือ `v1.0.0` |
| 2026-10-20 | งานที่กำลังทำย้ายไป `PLAN.md` + `docs/features/` จองงานด้วย draft PR | ผู้ใช้ขอให้ทีมทำงานตรงกันไม่ชนกัน · `spec.md` เหลือแค่สถานะระบบ |
| 2026-10-20 | ESLint ตั้งกฎที่มีของเดิมค้างเป็น warning แทนการแก้ทั้ง repo ใน PR เดียว; `rules-of-hooks` ยกเว้นแค่ workbench 3 ไฟล์ | ของเดิมหลายจุดอยู่ในไฟล์ hotspot ของ F001–F003 แก้รวดเดียวจะชนกับงานอื่น · ไฟล์ใหม่ยังโดนกฎเต็ม |
| 2026-10-20 | lint ไม่ใช้ type-aware rules (`recommendedTypeChecked`) | typecheck เป็นงานของ `tsc` อยู่แล้ว · type-aware ช้ากว่าหลายเท่าทั้งใน CI และ hook |
| 2026-10-20 | pre-commit hook ไม่ `--fix` ให้อัตโนมัติ | ไม่แก้ไฟล์ที่ stage แทนคน · คนเห็นและแก้เอง |
| ก่อนหน้า | ไม่ rollback Worker ไปรุ่นที่ไม่รู้จักห้อง `table` ใช้ `TABLE_READ_ONLY=true` แทน | ดู [TEAM_HANDOFF_TH](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน) |

## งานที่กำลังทำ

F006-T7 อยู่สถานะ review ใน [PR #32](https://github.com/Thanyers/tabletop/pull/32); README และ Handoff อ้างผล runtime ของ `ce6d69b` และสถานะ Cloudflare ที่อ่านได้จริง รอบ public demo เวลา 19:44 น. กด Play/Pause และเล่นเองได้ F=12, m=3, t=2 → 8 m โดยไม่มี API/cookie/socket/browser error ไม่เปลี่ยนฟีเจอร์หรือ deployment

ดู [PLAN.md](PLAN.md) — กระดานว่าใครทำงานไหน branch อะไร (ย้ายมาจากหัวข้อนี้เพื่อไม่ให้หลายคนแก้ส่วนเดียวกันจนชน)

งาน Generative Canvas ที่เริ่มก่อนมีกระดานทีมย้ายรายละเอียดไป [F005](docs/features/F005-generative-canvas.md) โดยคงขอบเขตและหลักฐานใน [acceptance](docs/GENERATIVE_CANVAS_ACCEPTANCE.md)

## ถัดไป

0. Release2.0.0ส่งแล้ว; งานต่อเริ่มจากF008draftและเกณฑ์ก่อนbetaกว้างในdocs/TEAM_HANDOFF_TH.md โดยไม่เปลี่ยนproductionอัตโนมัติ
1. **เจ้าของ repo (admin):** รันคำสั่ง ruleset ใน [AGENTS.md §9](AGENTS.md#9-ตั้งค่า-repo-ครั้งเดียว-admin-ของ-repo) เพื่อ protect `main` + `dev` และล็อก tag `v*`
2. งานถัดไปแตกจากdevและส่งreleaseใหม่ตามAGENTS.md; productionปัจจุบันยึดdocs/DEPLOYMENTS.md ห้ามrollbackไปwriterเก่าหลังบันทึกASTใหม่
3. แจ้งทีมว่างานใหม่ต้องเปิด PR เข้า `dev` เท่านั้น — #12–#14 ยังเข้า `main` ตรง
4. ลง Node 22.23.2 ให้ตรง CI · รัน `npm run test:r1:browser` (`BROWSER_CHANNEL=chrome`) ให้ครบ baseline
5. F001 เริ่มโต๊ะใหม่ด้วยคำถาม + การ์ดเดโม + AI ช่วยเลือก + แชท island — รอตอบคำถามเปิดใน [F001](docs/features/F001-guided-table-start.md#คำถามเปิด-ต้องตอบก่อนเริ่มงานที่เกี่ยว)
6. **CI002:** เคลียร์ ESLint warning 125 จุด (unused vars/imports, `no-unsafe-finally` ใน `tests/tabletop-r1.mjs`, `no-empty` ใน `src/state/store.ts` ฯลฯ) แล้วเลื่อนกฎใน `eslint.config.js` จาก `warn` เป็น `error` · แตกตามโฟลเดอร์เพื่อไม่ชนไฟล์ hotspot
7. งานผลิตภัณฑ์ที่ทีมจัดลำดับไว้ (ข้อเสนอ ยังไม่อนุมัติ): ดู [TEAM_HANDOFF_TH → สถานะและลำดับงาน](docs/TEAM_HANDOFF_TH.md#สถานะและลำดับงาน)
