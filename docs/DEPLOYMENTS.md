# Deployment ปัจจุบัน

ตรวจออนไลน์ล่าสุด **19 ตุลาคม 2026** ทั้งสอง environment ตอบ health/readiness/capabilities ผ่าน และไฟล์ที่ให้บริการทั้ง **131 ไฟล์** ตรงกับ build ของ source ด้านล่าง เป็นผล ณ เวลาตรวจ ไม่ใช่ระบบติดตาม uptime

| รายการ | Production | Staging |
| --- | --- | --- |
| URL | [tabletop.ptchrr.workers.dev](https://tabletop.ptchrr.workers.dev/) | [tabletop-staging.ptchrr.workers.dev](https://tabletop-staging.ptchrr.workers.dev/) |
| Worker | `tabletop` | `tabletop-staging` |
| D1 | `tabletop-production` | `tabletop-staging` |
| Durable Objects | `Room`, `Billing` ของ production | `Room`, `Billing` ใน namespace แยก |
| Source commit | [`6216eb3`](https://github.com/Thanyers/tabletop/commit/6216eb3a601f0bcadc1ff10d49c9116991b83069) — merge PR #4 | [`b28aeb6`](https://github.com/Thanyers/tabletop/commit/b28aeb6d8f36eb87539313987286f42e3eb93160) — tree เดียวกับ merge |
| Worker version | `acef420b-d1de-43d2-8de0-04e9302fc452` | `3102e813-f697-4a57-a348-77651ff720e5` |
| แผนที่เลือก | Workers Free | ใช้บัญชี Free เดียวกัน; quota อาจใช้ร่วมระดับบัญชี |
| เพดาน AI ในแอป | USD 1/วัน UTC และ USD 10/เดือน UTC | USD 0.20/วัน UTC และ USD 0.20/เดือน UTC |

`/demo` และ `/demo/replay` เป็นเส้นทางใน Worker เดียวกับแอป ไม่มีบริการ hosting แยก ส่วน localhost ใช้ได้เฉพาะเครื่องที่รัน ไม่ใช่ deployment สำหรับให้ทีมเปิดผ่านอินเทอร์เน็ต

GitHub repository เป็น **public**: [Thanyers/tabletop](https://github.com/Thanyers/tabletop/tree/main) source ที่ deploy เดิมมาจาก `feat/tabletop-r1` และรวมเข้า `main` ผ่าน [PR #2](https://github.com/Thanyers/tabletop/pull/2) แล้ว ให้ทีมเริ่มงานใหม่จาก main การ push หรือ merge เอกสารไม่ได้เปลี่ยน Worker โดยอัตโนมัติ CI ตรวจโค้ดและ build แต่ไม่มีขั้น deploy

## ผลตรวจ release ล่าสุด

[PR #4](https://github.com/Thanyers/tabletop/pull/4) รวมการจูน Canvas และแก้ required action text ที่ยอมรับข้อความว่าง/เว้นวรรคล้วน รุ่นนี้ไม่เปลี่ยน schema, secrets, bindings หรืองบ AI และไม่รัน migration เพิ่ม ก่อนส่ง staging สร้าง build ใหม่จาก clean source แล้วผูก source tree กับ asset manifest; production ใช้ tree และไฟล์ชุดเดียวกับ staging ที่ตรวจแล้ว

- [CI ของ candidate](https://github.com/Thanyers/tabletop/actions/runs/39263017525) ผ่าน รวม unit/local SQL 309 tests, Cloudflare 65 tests, Component Lab 7 tests, build/secret scan, persona demos และ browser acceptance ของ Node/Workers
- ทั้งสอง environment ผ่าน health/readiness/capabilities และ hash ไฟล์เว็บ 131 ไฟล์ตรงกับ build
- Staging: Google session เดิมกลับเข้าห้อง River Race ได้ที่ rules r2/data r7 คะแนน 8/6 และประวัติเดิมยังครบ แถบความสัมพันธ์ใหม่กดโฟกัส Boats ได้ สมาชิกไม่มีเครื่องมือแนบไฟล์ส่วนตัวของเจ้าของ
- Production: Google session เดิมกลับเข้าห้อง Encounter Table ได้ที่ rules r1/data r1, Goblin เป็นผู้เล่นเทิร์นปัจจุบัน, HP Mira/Pip/Goblin = 10/10/6 และกฎ shield เดิมยังอยู่ ไม่สร้างห้องทดสอบถาวรเพิ่ม
- [Helpdesk จากไฟล์ใหม่](CANVAS_HELPDESK_ACCEPTANCE.md) ใช้ DeepSeek จริงและสองบัญชีจำลองบน local เล่นครบสามงาน รวมปิดแท็บกลับมาเล่นต่อ ไม่ใช่หลักฐานทดสอบ Helpdesk ด้วยสอง Google accounts จริงบน production

การอ่าน state เดิมหลัง deploy ยังไม่ใช่หลักฐาน server restart recovery, load test หรือการกู้คืน D1 + Room + Billing ทั้งระบบ หลักฐาน operator ที่มีข้อมูลห้อง/บัญชีอยู่ใน ignored local `test-results/canvas-release-2026-10-19/`

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

Migration 0002 ทำแล้วในทั้งสอง environment ห้ามนำคำสั่ง provisioning รุ่นแรกไปรันซ้ำโดยถือว่าฐานยังว่าง การย้าย production คัดลอกข้อมูล directory 3 ห้องและสมาชิก 3 รายการครบ พร้อมสำรองเฉพาะตารางและทดสอบกู้คืน local; ยังไม่ใช่หลักฐานกู้คืน D1 + Room + Billing ทั้งระบบ ดูขั้นตอนรับงาน operator ใน [ทีมพัฒนาต่อ](TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)
