# Deployment ปัจจุบัน

ตรวจออนไลน์ล่าสุด **21 ตุลาคม 2569 เวลา 08:28 (Asia/Bangkok)** ทั้งสอง environment รายงาน **2.2.0 / f29e799** จาก annotated tag [v2.2.0](https://github.com/Thanyers/tabletop/tree/v2.2.0) และใช้ sealed build เดียวกัน Health/readiness/capabilities ผ่าน; AI เปิดและไม่ได้พักการแก้ไข ผลนี้เป็นการตรวจ ณ เวลาที่ระบุ ไม่ใช่ uptime monitor

| รายการ | Production | Staging |
| --- | --- | --- |
| URL | [tabletop.ptchrr.workers.dev](https://tabletop.ptchrr.workers.dev/) | [tabletop-staging.ptchrr.workers.dev](https://tabletop-staging.ptchrr.workers.dev/) |
| Worker / D1 | tabletop / tabletop-production | tabletop-staging / tabletop-staging |
| Durable Objects | Room และ Billing ของ production | Room และ Billing แยก namespace |
| Source | [f29e799](https://github.com/Thanyers/tabletop/commit/f29e799e5e6c25c9aafe57e8cd7d2a9ae61da542) — PR #48 | commit และ build เดียวกัน |
| Release | v2.2.0 / 2.2.0 | v2.2.0 / 2.2.0 |
| แผน | Workers Free | Free บัญชีเดียวกัน; quota บางส่วนใช้ร่วม |
| เพดาน AI | USD1/วัน UTC, USD10/เดือน UTC | USD0.20/วัน UTC, USD0.20/เดือน UTC |

/demo และ /demo/replay อยู่ใน Worker เดียวกัน merge `release/*` / `hotfix/*` เข้า `main` จะ deploy staging → production อัตโนมัติ ([CD001](TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001)); merge เอกสารหรือ branch อื่นไม่เปลี่ยน Worker

## ผลตรวจ deploy 2.2.0 (21 ตุลาคม 2569)

Release deploy รอบแรกของ CD001 ล้มที่ staging เพราะ config secret ยังมี `limits.cpu_ms` ซึ่ง Workers Free ไม่รับ (Cloudflare error 100328, [issue #49](https://github.com/Thanyers/tabletop/issues/49)) หลังแก้ config แล้วรันซ้ำด้วย SHA เดิม `f29e799` ([run 39527338589](https://github.com/Thanyers/tabletop/actions/runs/39527338589)) สำเร็จใน 81 วินาที

- Tag `v2.2.0` (annotated) → `f29e799`; build ครั้งเดียว `2.2.0 / f29e799` (`built_at` 2026-10-21T01:27:27Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `1f739525-09bf-4df0-8c22-8fbbcca0c717`, smoke PASS
- Production: Worker version `95d45422-f2f8-460c-9696-7a01744f93d1`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version` ตรงกับ tag, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `2.2.0 / f29e799`
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
