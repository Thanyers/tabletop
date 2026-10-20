# Deployment ปัจจุบัน

ตรวจออนไลน์ล่าสุด **20 ตุลาคม 2026** ทั้งสอง environment ตอบ health/readiness/capabilities ผ่าน และไฟล์ที่ให้บริการทั้ง **130 ไฟล์** ตรงกับ build ที่ผูกกับ source ด้านล่าง เป็นผล ณ เวลาตรวจ ไม่ใช่ระบบติดตาม uptime

| รายการ | Production | Staging |
| --- | --- | --- |
| URL | [tabletop.ptchrr.workers.dev](https://tabletop.ptchrr.workers.dev/) | [tabletop-staging.ptchrr.workers.dev](https://tabletop-staging.ptchrr.workers.dev/) |
| Worker | `tabletop` | `tabletop-staging` |
| D1 | `tabletop-production` | `tabletop-staging` |
| Durable Objects | `Room`, `Billing` ของ production | `Room`, `Billing` ใน namespace แยก |
| Source commit | [`c9d3bf0`](https://github.com/Thanyers/tabletop/commit/c9d3bf090836389710d31c91d7dd3cdc360888bf) — merge PR #6 | [`bec8e30`](https://github.com/Thanyers/tabletop/commit/bec8e30e793dbfce7920fe2d708c3de731dda214) — tree เดียวกับ merge |
| Worker version | `cac0be4d-b09a-4b05-b83a-6cec04cd86d3` | `f6cf1dfe-71ea-4ff2-aac7-23be8acfbe99` |
| แผนที่เลือก | Workers Free | ใช้บัญชี Free เดียวกัน; quota อาจใช้ร่วมระดับบัญชี |
| เพดาน AI ในแอป | USD 1/วัน UTC และ USD 10/เดือน UTC | USD 0.20/วัน UTC และ USD 0.20/เดือน UTC |

`/demo` และ `/demo/replay` เป็นเส้นทางใน Worker เดียวกับแอป ไม่มีบริการ hosting แยก ส่วน localhost ใช้ได้เฉพาะเครื่องที่รัน ไม่ใช่ deployment สำหรับให้ทีมเปิดผ่านอินเทอร์เน็ต

GitHub repository เป็น **public**: [Thanyers/tabletop](https://github.com/Thanyers/tabletop/tree/main) ให้ทีมเริ่มงานใหม่จาก main การ push หรือ merge เอกสารไม่ได้เปลี่ยน Worker โดยอัตโนมัติ CI ตรวจโค้ดและ build แต่ไม่มีขั้น deploy

## ผลตรวจ release ล่าสุด

[PR #6](https://github.com/Thanyers/tabletop/pull/6) ปรับการ์ดและระบบภาพตาม [Calm Canvas](CALM_CANVAS_DESIGN.md): ลากหัวการ์ดได้ตลอดโดยไม่มี Use/Arrange เปิดทุกเครื่องมือผ่าน Objects วางแชทในโต๊ะ ลดข้อความซ้ำ และเลือกแถวเพื่อทำรายการได้ รุ่นนี้ไม่เปลี่ยน schema, secrets, bindings หรืองบ AI และไม่รัน migration เพิ่ม ก่อนส่ง staging สร้าง build ใหม่จาก clean source แล้วผูก source tree กับ asset manifest; production ใช้ tree และไฟล์ชุดเดียวกับ staging ที่ตรวจแล้ว

- [CI ของ candidate](https://github.com/Thanyers/tabletop/actions/runs/39358949964) ผ่าน รวม unit/local SQL 309 tests, Cloudflare 65 tests, Component Lab 7 tests, build/secret scan, persona demos และ browser acceptance ของ Node/Workers
- ทั้งสอง environment ผ่าน health/readiness/capabilities และ hash ไฟล์เว็บ 130 ไฟล์ตรงกับ build
- Staging: ใช้ Google สองบัญชีจริงในห้อง River Race เดิม ตรวจสิทธิ์ตามตา เล่น Advance boat คนละครั้ง คะแนนจาก 8/6 เป็น 11/9 ทั้งสองฝั่งตรงกัน และกลับเข้าห้องเดิมได้หลังปิด/เปิดแท็บ; สมาชิกไม่มีไฟล์ส่วนตัวหรือเครื่องมือสร้างกฎของเจ้าของ
- Production: อ่านห้อง Encounter Table เดิมหลัง deploy โดยไม่ทำรายการ HP Mira/Pip/Goblin = 10/10/6, Goblin เป็นเทิร์นปัจจุบัน และกฎ ally shield เดิมยังอยู่ หน้าตาใหม่เปิดเครื่องมือจาก Canvas ได้
- [Helpdesk จากไฟล์ใหม่](CALM_CANVAS_ACCEPTANCE.md) ใช้ DeepSeek จริงและสองบัญชีจำลองบน local เล่นครบสามงาน รวม 14 actions ตรวจ blocked/wrong-assignee, reload/resume และแชทสรุปจริง; เดโมทั้งสามแบบเล่นจบและรับช่วงด้วยมือ เป็นคนละขอบเขตกับ Google สองบัญชีบน staging
- SKIPPED: automated axe / full contrast / screen-reader audit, นิ้วบนโทรศัพท์จริง และการเปลี่ยนระหว่างหลักฐาน invoice สองชิ้น ดูขอบเขตในรายงาน local

การกลับเข้าห้องเดิมหลัง deploy ยังไม่ใช่หลักฐาน server restart recovery, load test หรือการกู้คืน D1 + Room + Billing ทั้งระบบ หลักฐาน operator ที่มีข้อมูลห้อง/บัญชีอยู่ใน ignored local `test-results/calm-canvas-2026-10-20/`

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
| 18 ต.ค. รุ่นแรก | Google, ห้องเดิมสามแบบ, ledger และ Cloudflare Free | [บันทึกรุ่นแรก](CLOUDFLARE_RELEASE.md) |
| 19 ต.ค. `ba29062` | Shared data table, ไฟล์ข้อความ, แชทส่วนตัว/confirmation และ migration 0002 | [Generic table acceptance](GENERIC_TABLE_ACCEPTANCE.md) |
| 19 ต.ค. `f1725c8` | ภาพที่เตรียมไว้ใน interactive demo | [Demo art](DEMO_ART.md), [CI ของรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39235880486) |
| 19 ต.ค. `6216eb3` | Canvas flow, draft lifecycle, ผลตรวจบิลและการปฏิเสธ blank action text | [PR #4](https://github.com/Thanyers/tabletop/pull/4), [Helpdesk acceptance](CANVAS_HELPDESK_ACCEPTANCE.md) |
| 20 ต.ค. `c9d3bf0` | Calm Canvas, การ์ดโทนอุ่น, ช่องพิมพ์ในโต๊ะ, contextual actions และไม่มี Use/Arrange | [PR #6](https://github.com/Thanyers/tabletop/pull/6), [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) |

Migration 0002 ทำแล้วในทั้งสอง environment ห้ามนำคำสั่ง provisioning รุ่นแรกไปรันซ้ำโดยถือว่าฐานยังว่าง การย้าย production คัดลอกข้อมูล directory 3 ห้องและสมาชิก 3 รายการครบ พร้อมสำรองเฉพาะตารางและทดสอบกู้คืน local; ยังไม่ใช่หลักฐานกู้คืน D1 + Room + Billing ทั้งระบบ ดูขั้นตอนรับงาน operator ใน [ทีมพัฒนาต่อ](TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)
