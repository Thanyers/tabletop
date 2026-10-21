# Deployment ปัจจุบัน

ตรวจออนไลน์ล่าสุด **21 ตุลาคม 2569 เวลา 22:54 (Asia/Bangkok)** ทั้งสอง environment รายงาน **3.4.0 / 442e074** จาก annotated tag [v3.4.0](https://github.com/Thanyers/tabletop/tree/v3.4.0) และใช้ sealed build เดียวกัน Health/readiness/capabilities ผ่าน; AI เปิดและไม่ได้พักการแก้ไข ผลนี้เป็นการตรวจ ณ เวลาที่ระบุ ไม่ใช่ uptime monitor

| รายการ | Production | Staging |
| --- | --- | --- |
| URL | [tabletop.ptchrr.workers.dev](https://tabletop.ptchrr.workers.dev/) | [tabletop-staging.ptchrr.workers.dev](https://tabletop-staging.ptchrr.workers.dev/) |
| Worker / D1 | tabletop / tabletop-production | tabletop-staging / tabletop-staging |
| Durable Objects | Room และ Billing ของ production | Room และ Billing แยก namespace |
| Source | [442e074](https://github.com/Thanyers/tabletop/commit/442e074a743c654dbbb448488b46165936a3c4d9) — PR #102 | commit และ build เดียวกัน |
| Release | v3.4.0 / 3.4.0 | v3.4.0 / 3.4.0 |
| แผน | Workers Free | Free บัญชีเดียวกัน; quota บางส่วนใช้ร่วม |
| เพดาน AI | USD1/วัน UTC, USD10/เดือน UTC | USD0.20/วัน UTC, USD0.20/เดือน UTC |

/demo และ /demo/replay อยู่ใน Worker เดียวกัน merge `release/*` / `hotfix/*` เข้า `main` จะ deploy staging → production อัตโนมัติ ([CD001](TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001)); merge เอกสารหรือ branch อื่นไม่เปลี่ยน Worker

## ผลตรวจ deploy 3.3.2 (21 ตุลาคม 2569)

Release 3.3.2 (PATCH) ผ่าน pipeline CD001 — [PR #96](https://github.com/Thanyers/tabletop/pull/96) จาก `dev` @ `0f360c9` · รวม F025 (refresh race), F026 (บังคับภาษา clarify), F027 (hint ตอน reject), F028 (fallback ตารางขั้นต่ำ), F029 (golden corpus)

- Tag `v3.3.2` (annotated) → `957074d`; build ครั้งเดียว `3.3.2 / 957074d` (`built_at` 2026-10-21T13:49:50Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `eaec9c18-56bd-4696-8463-ee71a12f2a72`, smoke PASS
- Production: Worker version `2f5f6e53-cd9c-4c94-9feb-9f6a0e575b43`, smoke PASS
- `/version` หลัง deploy ทั้งสอง environment = `3.3.2 / 957074d`
- ตรวจซ้ำบน production 5 เคส: injection เป็นอังกฤษ, join ได้ draft, dragon ไม่มี refresh error, vague/toomany clarify — ดู [report](../test-results/weird-cases-3.3.2/REPORT.md) (local, ignored)
- `dev` รับ release คืนผ่าน [PR #97](https://github.com/Thanyers/tabletop/pull/97)

## ผลตรวจ deploy 3.3.1 (21 ตุลาคม 2569)

Release 3.3.1 (PATCH) ผ่าน pipeline CD001 — [PR #89](https://github.com/Thanyers/tabletop/pull/89) จาก `dev` @ `942e2c6` · รวม F024 (repair escalation)

- Tag `v3.3.1` (annotated) → `6c6bfcc`; build ครั้งเดียว `3.3.1 / 6c6bfcc` (`built_at` 2026-10-21T12:00:01Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `e2558859-a6e3-41b5-ac39-35262e61dce6`, smoke PASS
- Production: Worker version `8a6a4c97-914b-4c77-a899-52eb11c118b1`, smoke PASS
- `/version` หลัง deploy ทั้งสอง environment = `3.3.1 / 6c6bfcc`
- `dev` รับ release คืนผ่าน [PR #90](https://github.com/Thanyers/tabletop/pull/90)

## ผลตรวจ deploy 3.3.0 (21 ตุลาคม 2569)

Release 3.3.0 (MINOR) ผ่าน pipeline CD001 — [PR #84](https://github.com/Thanyers/tabletop/pull/84) จาก `dev` @ `356e734` · รวม F023 (salvage การ์ดภาพ), F022 (ตอบหลายคำตอบ), F021 (พิมพ์ระหว่างรอ), F020 (ข้อความ field), F003-T1 (เตะสมาชิก), F003-T3 (invite link ใช้ซ้ำ)

- Tag `v3.3.0` (annotated) → `457373a`; build ครั้งเดียว `3.3.0 / 457373a` (`built_at` 2026-10-21T11:09:07Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `f413119b-3100-4e5f-85b9-0ecd6f9879b7`, smoke PASS
- Production: Worker version `ffe13c48-a02f-4821-b7a3-cba1b2638943`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.3.0 / 457373a`
- `dev` รับ release คืนผ่าน [PR #86](https://github.com/Thanyers/tabletop/pull/86)

## ผลตรวจ deploy 3.2.0 (21 ตุลาคม 2569)

Release 3.2.0 (MINOR) ผ่าน pipeline CD001 — [PR #76](https://github.com/Thanyers/tabletop/pull/76) จาก `dev` @ `25210ad` · รวม F018 (รักษา canvas views ตอน evolve) และ F019 (capability registry + panel)

- Tag `v3.2.0` (annotated) → `430b0c9`; build ครั้งเดียว `3.2.0 / 430b0c9` (`built_at` 2026-10-21T08:33:38Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `3b280d8d-d27c-4db7-b034-b2dd872c3b38`, smoke PASS
- Production: Worker version `d4e71a3c-7503-4da5-9d99-c5a2480271a5`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.2.0 / 430b0c9`
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ยังไม่ได้เล่นสองบัญชีหรือทดสอบฟีเจอร์ใหม่บน hosted

## ผลตรวจ deploy 3.1.0 (21 ตุลาคม 2569)

Release 3.1.0 (MINOR) ผ่าน pipeline CD001 — [PR #68](https://github.com/Thanyers/tabletop/pull/68) จาก `dev` @ `dc38dcc` · รวม F015 (import rows), F016 (validation reasons) และ F017 (computed columns)

- Tag `v3.1.0` (annotated) → `f8a6b43`; build ครั้งเดียว `3.1.0 / f8a6b43` (`built_at` 2026-10-21T07:10:14Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `d20c9263-c367-4008-b9a3-f90d95ce9ac0`, smoke PASS
- Production: Worker version `444f9abf-1d03-482e-a864-f35b52a2f402`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.1.0 / f8a6b43`
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ยังไม่ได้เล่นสองบัญชีหรือทดสอบฟีเจอร์ใหม่บน hosted

## ผลตรวจ deploy 3.0.0 (21 ตุลาคม 2569)

Release 3.0.0 (MAJOR) ผ่าน pipeline CD001 ครบทุกขั้น — branch `release/3.0.0` ([PR #59](https://github.com/Thanyers/tabletop/pull/59)) จาก `dev` @ `a22122d` + merge `main` (v2.2.0) · เป็น MAJOR เพราะ F010 บันทึก contract ใหม่ของกฎ/Canvas ที่ writer รุ่นก่อนอ่านไม่ได้หลังเขียน

- Tag `v3.0.0` (annotated) → `df1e5f5`; build ครั้งเดียว `3.0.0 / df1e5f5` (`built_at` 2026-10-21T04:30:03Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `c33846ea-b41a-4338-bdf8-40a8c474abe9`, smoke PASS
- Production: Worker version `d22ff83e-b67d-47bd-9883-bcdc217aaf42`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.0.0 / df1e5f5`
- รุ่นนี้รวม F010/F011/F012/F014, CD002 (retry-once) และ CD003 (draft-refresh failure) จาก 2.2.0
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ยังไม่ได้เล่นสองบัญชีหรือทดสอบ F010/F012 บน hosted ใหม่

## ผลตรวจ deploy 2.2.0 (21 ตุลาคม 2569)

Release deploy รอบแรกของ CD001 ล้มที่ staging เพราะ config secret ยังมี `limits.cpu_ms` ซึ่ง Workers Free ไม่รับ (Cloudflare error 100328, [issue #49](https://github.com/Thanyers/tabletop/issues/49)) หลังแก้ config แล้วรันซ้ำด้วย SHA เดิม `f29e799` ([run 39527338589](https://github.com/Thanyers/tabletop/actions/runs/39527338589)) สำเร็จใน 81 วินาที

- Tag `v2.2.0` (annotated) → `f29e799`; build ครั้งเดียว `2.2.0 / f29e799` (`built_at` 2026-10-21T01:27:27Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `1f739525-09bf-4df0-8c22-8fbbcca0c717`, smoke PASS
- Production: Worker version `95d45422-f2f8-460c-9696-7a01744f93d1`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version` ตรงกับ tag, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `2.2.0 / f29e799`
- **deploy ซ้ำโดยไม่จำเป็น 09:24–09:25 (Asia/Bangkok):** [run 39532864723](https://github.com/Thanyers/tabletop/actions/runs/39532864723) ถูกสั่งรันด้วย SHA เดิมหลังจากรอบ 01:27Z สำเร็จไปแล้ว (ผู้สั่งไม่เห็นรอบก่อนหน้า) และสั่งยกเลิกไม่ทันก่อนจบ ผลคือ code เดิม `2.2.0 / f29e799` ที่ build ใหม่ (`built_at` 2026-10-21T02:25:24Z) · D1 ไม่มี migration ค้าง · smoke ผ่านทุกจุดทั้งสอง environment · Worker version ปัจจุบัน: staging `d38a193d-9bcb-4962-9758-f0a1bc2dfee9`, production `b55d3f12-5d89-4718-9f75-04df5ead15a1` · ก่อนสั่ง Release deploy ด้วยมือ ให้ดู Actions ว่ามีรอบของ SHA นั้นสำเร็จแล้วหรือยัง
- รุ่นนี้รวมงาน 2.1.0 (F008/F009/F001) และ 2.2.0 (F013 consent ครั้งเดียว + CD001) — ยังไม่อัปเกรดแผน ยังใช้ Workers Free
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ไม่ได้เล่นสองบัญชีหรือทดสอบ F013 บน hosted ใหม่ (หลักฐานสองบัญชีล่าสุดยังเป็นรุ่น 2.0.0)

## ผลตรวจ release ล่าสุด

รุ่น2.0 รวม Generative Canvas, แชทด้านล่างของโต๊ะทั่วไป, ตั้งชื่อโต๊ะ และตำแหน่งการ์ดร่วม พร้อมแก้บั๊ก turn-form preview ที่พบจากการเล่นจริง ผ่าน staging สองบัญชีก่อน merge [PR #33](https://github.com/Thanyers/tabletop/pull/33) → [main CI 39439056507](https://github.com/Thanyers/tabletop/actions/runs/39439056507) → annotated tag → clean tagged build → staging → production โดยใช้ build ชุดเดียวกัน ไม่มี SQL migration หรือการเปลี่ยน secrets/bindings/งบ

- Node22.23.2; unit376, Cloudflare71, browser Node7/Worker25/generated4เรื่อง8checks ผ่าน
- Served assets135/135 ต่อ environment ตรง sealed manifest และ Worker content2modules ตรงระหว่าง staging/prod; /version เป็น2.0.0/d93620d
- สอง Google accounts เล่นคาเฟ่/เกมแบ่งน้ำจริงบน staging พร้อม AI, private trial, activation, turn/actions, shared drag, private chat, close/reopen และ read-only rejection/restore
- Final tagged staging เปิดทั้งสองห้องด้วยสองบัญชีเดิม ผลคาเฟ่8/0; น้ำ65/20/15รวม100 ยังครบ ไม่สร้างห้องหรือเรียก AI เพิ่มระหว่าง final promotion
- Production readback ไม่สร้างห้อง ไม่ส่งคำสั่งเล่น และไม่เรียก AI; ไม่ใช่การเล่นเต็มซ้ำบน production

ดู provenance ของแต่ละ candidate, bugfix, ข้อจำกัด และหลักฐานทดสอบใน [Release2.0 acceptance](RELEASE_2_0_ACCEPTANCE.md) เก็บ receipts ที่มีข้อมูลเฉพาะบัญชีไว้ใน ignored local เท่านั้น

**Recovery:** หลังเขียน expression/Canvas JSON ใหม่ ห้าม rollback ไป writer1.1หรือต่ำกว่า ใช้ compatible build, TABLE_READ_ONLY และ forward fix การซ้อมครั้งนี้พิสูจน์การปฏิเสธ writes/AI และเปิดคืน ไม่ใช่ full backup/restore

## สิ่งที่ใช้และค่าใช้จ่าย

ใช้ Workers Static Assets/API + D1 + SQLite Durable Objects + Google OAuth + DeepSeek ฝั่งเซิร์ฟเวอร์ ยังไม่ได้เปิด R2, Render, Supabase หรือ custom domain และไม่ได้เปิด Workers Paid

ค่าฐานของแผนที่เลือกเป็น Free; ค่า AI คิดตามใช้จริงและมี ledger จำกัดเฉพาะคำขอจาก Tabletop เพดานข้างต้นไม่ครอบคลุมการใช้ provider key ที่แอปอื่น และไม่ใช่การรับประกัน capacity หรือ hard cap ค่าโครงสร้างพื้นฐาน ข้อมูลราคาและสมมติฐานเดิมอยู่ใน [production setup](PRODUCTION_SETUP.md#ค่าใช้จ่ายรายเดือน) พร้อมวันที่ตรวจ ต้องทวนราคาก่อนเปลี่ยนแผน

## Secret อยู่ที่ไหน

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TABLETOP_ADMIN_EMAIL`, `DEEPSEEK_KEY` อยู่ใน Worker Secrets ของแต่ละ environment
- `CLOUDFLARE_API_TOKEN` และ `GITHUB_TOKEN` ใช้บนเครื่องผู้ดูแลสำหรับส่งโค้ด/ตั้งระบบ ไม่เป็นส่วนหนึ่งของ browser bundle
- Git เก็บ source และชื่อ config เท่านั้น `wrangler.jsonc` ใช้ D1 ID placeholder และงบ AI เป็นศูนย์ ไม่ใช่ config production ที่พร้อมสั่ง deploy ทันที
- คนพัฒนา local ใช้ fixture ได้โดยไม่ต้องขอ production keys ถ้ารับหน้าที่ operator ให้รับสิทธิ์ผ่านช่องทางของเจ้าของบริการ ไม่ส่งค่า secret ใน issue, PR หรือแชททีม

## ประวัติ release ที่เกี่ยวข้อง

| Release | สิ่งที่ส่ง | หลักฐาน |
| --- | --- | --- |
| 21 ต.ค. `v3.4.0` / `442e074` | F031 thinking/caps/compact guide/180s, F030 corpus rounds | [PR #102](https://github.com/Thanyers/tabletop/pull/102), [run 39629734074](https://github.com/Thanyers/tabletop/actions/runs/39629734074) |
| 21 ต.ค. `v3.3.2` / `957074d` | F025 refresh race, F026 clarify language, F027 reject hint, F028 minimal fallback, F029 corpus | [PR #96](https://github.com/Thanyers/tabletop/pull/96), [run 39611292996](https://github.com/Thanyers/tabletop/actions/runs/39611292996), [PR #97](https://github.com/Thanyers/tabletop/pull/97) |
| 21 ต.ค. `v3.3.1` / `6c6bfcc` | F024 repair escalation (issue ซ้ำ → ลดความซับซ้อน) | [PR #89](https://github.com/Thanyers/tabletop/pull/89), [run 39596026230](https://github.com/Thanyers/tabletop/actions/runs/39596026230), [PR #90](https://github.com/Thanyers/tabletop/pull/90) |
| 21 ต.ค. `v3.3.0` / `457373a` | F023 salvage, F022 multi-answer, F021 type while pending, F020 field messages, F003-T1 remove member, F003-T3 reusable invite link | [PR #84](https://github.com/Thanyers/tabletop/pull/84), [run 39589703856](https://github.com/Thanyers/tabletop/actions/runs/39589703856), [PR #86](https://github.com/Thanyers/tabletop/pull/86) |
| 21 ต.ค. `v3.2.0` / `430b0c9` | F018 preserve canvas views, F019 capability panel + `/api/capabilities.table` | [PR #76](https://github.com/Thanyers/tabletop/pull/76), [run 39570078824](https://github.com/Thanyers/tabletop/actions/runs/39570078824), [PR #78](https://github.com/Thanyers/tabletop/pull/78) |
| 21 ต.ค. `v3.1.0` / `f8a6b43` | F015 import rows, F016 validation reasons, F017 computed columns | [PR #68](https://github.com/Thanyers/tabletop/pull/68), [run 39560013409](https://github.com/Thanyers/tabletop/actions/runs/39560013409), [PR #69](https://github.com/Thanyers/tabletop/pull/69) |
| 21 ต.ค. `v3.0.0` / `df1e5f5` | F010/F011/F012/F014 + CD002/CD003 จาก 2.2.0; MAJOR เพราะ contract ใหม่ของกฎ/Canvas | [PR #59](https://github.com/Thanyers/tabletop/pull/59), [run 39544308701](https://github.com/Thanyers/tabletop/actions/runs/39544308701), [PR #61](https://github.com/Thanyers/tabletop/pull/61) |
| 21 ต.ค. `v2.2.0` / `f29e799` | Consent ส่ง AI ครั้งเดียวต่อโต๊ะ (F013) รวมงาน 2.1.0 ที่ยังไม่เคยขึ้น hosted และ pipeline CD001 ที่ใช้งานจริงบน Workers Free | [PR #48](https://github.com/Thanyers/tabletop/pull/48), [run 39527338589](https://github.com/Thanyers/tabletop/actions/runs/39527338589), [issue #49](https://github.com/Thanyers/tabletop/issues/49) |
| 20 ต.ค. `v1.0.0` / `ce2c50e` | Build จาก release tag; UI และ runtime เดิม เปลี่ยนเฉพาะข้อมูล version | [PR #15](https://github.com/Thanyers/tabletop/pull/15), [CI main](https://github.com/Thanyers/tabletop/actions/runs/39376131015) |
| 18 ต.ค. รุ่นแรก | Google, ห้องเดิมสามแบบ, ledger และ Cloudflare Free | [บันทึกรุ่นแรก](CLOUDFLARE_RELEASE.md) |
| 19 ต.ค. `ba29062` | Shared data table, ไฟล์ข้อความ, แชทส่วนตัว/confirmation และ migration 0002 | [Generic table acceptance](GENERIC_TABLE_ACCEPTANCE.md) |
| 19 ต.ค. `f1725c8` | ภาพที่เตรียมไว้ใน interactive demo | [Demo art](DEMO_ART.md), [CI ของรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39235880486) |
| 19 ต.ค. `6216eb3` | Canvas flow, draft lifecycle, ผลตรวจบิลและการปฏิเสธ blank action text | [PR #4](https://github.com/Thanyers/tabletop/pull/4), [Helpdesk acceptance](CANVAS_HELPDESK_ACCEPTANCE.md) |
| 20 ต.ค. `c9d3bf0` | Calm Canvas, การ์ดโทนอุ่น, ช่องพิมพ์ในโต๊ะ, contextual actions และไม่มี Use/Arrange | [PR #6](https://github.com/Thanyers/tabletop/pull/6), [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) |
| 20 ต.ค. `9fbfdec` | ข้อความเริ่มงานตามแนวคิดใหม่ ฟีเจอร์หลักเดิม และ `/version` สำหรับตรวจ build | [PR #9](https://github.com/Thanyers/tabletop/pull/9), [PR #10](https://github.com/Thanyers/tabletop/pull/10), [CI ของรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39368620190) |
| 20 ต.ค. `524d9cc` | หน้าแนวคิดก่อนล็อกอิน พร้อมภาพการงอกของเครื่องมือ; หน้าโต๊ะและฟีเจอร์หลักเดิม | [PR #13](https://github.com/Thanyers/tabletop/pull/13), [Public welcome acceptance](PUBLIC_WELCOME_ACCEPTANCE.md), [CI ของ candidate](https://github.com/Thanyers/tabletop/actions/runs/39373019632) |

Migration 0002 ทำแล้วในทั้งสอง environment ห้ามนำคำสั่ง provisioning รุ่นแรกไปรันซ้ำโดยถือว่าฐานยังว่าง การย้าย production คัดลอกข้อมูล directory 3 ห้องและสมาชิก 3 รายการครบ พร้อมสำรองเฉพาะตารางและทดสอบกู้คืน local; ยังไม่ใช่หลักฐานกู้คืน D1 + Room + Billing ทั้งระบบ ดูขั้นตอนรับงาน operator ใน [ทีมพัฒนาต่อ](TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)
