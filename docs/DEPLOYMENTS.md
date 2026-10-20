# Deployment ปัจจุบัน

ตรวจออนไลน์ล่าสุด **20 ตุลาคม 2026 เวลา 12:15 น. (Asia/Bangkok)** ทั้งสอง environment ตอบ health/readiness/capabilities ผ่าน และไฟล์ที่ให้บริการทั้ง **135 ไฟล์** ตรงกับ build ชุดเดียวกัน `GET /version` รายงาน `sha: 524d9cc` ตรงกับ source ด้านล่าง เป็นผล ณ เวลาตรวจ ไม่ใช่ระบบติดตาม uptime

| รายการ | Production | Staging |
| --- | --- | --- |
| URL | [tabletop.ptchrr.workers.dev](https://tabletop.ptchrr.workers.dev/) | [tabletop-staging.ptchrr.workers.dev](https://tabletop-staging.ptchrr.workers.dev/) |
| Worker | `tabletop` | `tabletop-staging` |
| D1 | `tabletop-production` | `tabletop-staging` |
| Durable Objects | `Room`, `Billing` ของ production | `Room`, `Billing` ใน namespace แยก |
| Source commit | [`524d9cc`](https://github.com/Thanyers/tabletop/commit/524d9cc21198a748ca2dca50d3190e392aec7ed5) — PR #13 | [`524d9cc`](https://github.com/Thanyers/tabletop/commit/524d9cc21198a748ca2dca50d3190e392aec7ed5) — build ชุดเดียวกัน |
| Worker version | `6277ed24-279d-4c47-b868-fd420f0b05f8` | `923a8a9f-01a4-4d67-a8ab-e855c8def8e7` |
| แผนที่เลือก | Workers Free | ใช้บัญชี Free เดียวกัน; quota อาจใช้ร่วมระดับบัญชี |
| เพดาน AI ในแอป | USD 1/วัน UTC และ USD 10/เดือน UTC | USD 0.20/วัน UTC และ USD 0.20/เดือน UTC |

`/demo` และ `/demo/replay` เป็นเส้นทางใน Worker เดียวกับแอป ไม่มีบริการ hosting แยก ส่วน localhost ใช้ได้เฉพาะเครื่องที่รัน ไม่ใช่ deployment สำหรับให้ทีมเปิดผ่านอินเทอร์เน็ต

GitHub repository เป็น **public**: [Thanyers/tabletop](https://github.com/Thanyers/tabletop/tree/main) ให้ทีมเริ่มงานใหม่จาก main การ push หรือ merge เอกสารไม่ได้เปลี่ยน Worker โดยอัตโนมัติ CI ตรวจโค้ดและ build แต่ไม่มีขั้น deploy

## ผลตรวจ release ล่าสุด

[PR #13](https://github.com/Thanyers/tabletop/pull/13) เพิ่มหน้าเล่าแนวคิดสำหรับคนที่ยังไม่ล็อกอิน พร้อมภาพ Remotion การงอกของเครื่องมือ ตัวอย่างงาน/การเรียนรู้/การเล่น ขอบเขต beta และทางเข้า Google/เดโมเดิม หลังล็อกอินยังใช้ข้อความเริ่มงานและ Canvas เดิม ไม่มีข้อความขายเพิ่ม ดู [Public welcome acceptance](PUBLIC_WELCOME_ACCEPTANCE.md)

เมื่อเทียบกับรุ่น production ก่อนหน้า โค้ดกฎการเล่น สิทธิ์ สมาชิก และการเก็บข้อมูลไม่เปลี่ยน ไม่มี schema/migration, secrets, bindings, เส้นทาง Worker หรืองบ AI เปลี่ยน ตรวจ tree ของ merge ให้ตรงกับ candidate ที่ผ่าน CI แล้วสร้าง build และผูก source tree กับ asset manifest; production ใช้ไฟล์ชุดเดียวกับ staging ที่ตรวจแล้ว

- [CI ของ candidate ที่มี tree ตรงกับรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39373019632) ผ่าน unit/local SQL, Cloudflare, Component Lab, build/secret scan, persona demos และ browser acceptance ของ Node/Workers รวมกรณี anonymous/login/invite เดิมและใหม่; fixture ไม่ได้เรียก Google หรือ AI provider จริง
- ทั้งสอง environment ผ่าน health/readiness/capabilities, `/version` ตรงกับ source และ hash ไฟล์เว็บ 135 ไฟล์ตรงกับ build; bindings/settings เดิมครบ
- ตรวจหน้า production จาก browser ที่ยังไม่ล็อกอินจริง: เรื่องเล่าใหม่และ Google link ถูกต้อง ไม่มี Canvas, ภาพนิ่งเปิดได้ และ viewport 1280×900 กับ 390×844 ไม่มีแนวนอนล้น
- ตรวจหน้าเริ่มงานผ่าน browser ที่ล็อกอินอยู่จริงทั้ง staging และ production: **What are you here to do?** กับ **Start with your files** ยังอยู่ และไม่มี public welcome
- Staging: เปิด Shift Swap เดิมแบบอ่านอย่างเดียว กฎ active r1, data r2, 3 records และประวัติ 2 รายการยังอยู่
- Production: เปิด Encounter Table เดิมแบบอ่านอย่างเดียว HP Mira/Pip/Goblin = 10/10/6, AP = 2/2/2, เทิร์น Goblin และกฎ ally shield r1 เดิมยังอยู่
- รอบนี้ไม่ได้สร้างห้อง ทำ action อัปโหลดไฟล์ หรือเรียก AI; ไม่ได้ทดสอบ Google sign-in ใหม่หรือเล่นสองบัญชีรอบใหม่ หลักฐานการเล่นสองบัญชีและ Helpdesk จากไฟล์ใหม่อยู่ใน [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) และประวัติรุ่นก่อนหน้า
- SKIPPED: physical touch device, automated axe / full contrast / screen-reader audit, load/soak, restart/restore drill และรอบเล่นเต็มเพิ่มเติม

การกลับเข้าห้องเดิมหลัง deploy ยังไม่ใช่หลักฐาน server restart recovery, load test หรือการกู้คืน D1 + Room + Billing ทั้งระบบ หลักฐาน operator อยู่ใน ignored local `test-results/public-welcome-2026-10-20/` พร้อมรุ่นก่อนหน้าสำหรับ rollback ที่เข้ากันได้ รอบนี้ไม่ต้องใช้ rollback

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
| 20 ต.ค. `9fbfdec` | ข้อความเริ่มงานตามแนวคิดใหม่ ฟีเจอร์หลักเดิม และ `/version` สำหรับตรวจ build | [PR #9](https://github.com/Thanyers/tabletop/pull/9), [PR #10](https://github.com/Thanyers/tabletop/pull/10), [CI ของรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39368620190) |
| 20 ต.ค. `524d9cc` | หน้าแนวคิดก่อนล็อกอิน พร้อมภาพการงอกของเครื่องมือ; หน้าโต๊ะและฟีเจอร์หลักเดิม | [PR #13](https://github.com/Thanyers/tabletop/pull/13), [Public welcome acceptance](PUBLIC_WELCOME_ACCEPTANCE.md), [CI ของ candidate](https://github.com/Thanyers/tabletop/actions/runs/39373019632) |

Migration 0002 ทำแล้วในทั้งสอง environment ห้ามนำคำสั่ง provisioning รุ่นแรกไปรันซ้ำโดยถือว่าฐานยังว่าง การย้าย production คัดลอกข้อมูล directory 3 ห้องและสมาชิก 3 รายการครบ พร้อมสำรองเฉพาะตารางและทดสอบกู้คืน local; ยังไม่ใช่หลักฐานกู้คืน D1 + Room + Billing ทั้งระบบ ดูขั้นตอนรับงาน operator ใน [ทีมพัฒนาต่อ](TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)
