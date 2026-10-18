# Tabletop R1 — ผลทดสอบหลังเปิดระบบ

18 ตุลาคม 2026 · Asia/Bangkok · อัปเดตหลักฐานถึง 21:03 น.

**อัปเดต 19 ตุลาคม 2026 เวลา 04:56 น. Bangkok:** เจ้าของอนุมัติเฉพาะห้อง `Encounter Table` และเปิดกติกา r1 สำเร็จแล้ว ตรวจหลัง reload ยังคง ACTIVE พร้อม revision 0/1 รายงานด้านล่างคงผล ณ รอบ 18 ตุลาคมไว้เพื่อไม่เขียนทับประวัติ ดู [บันทึกการเปิดใช้](../../../docs/auto-demo/hosted-activation-2026-10-19.json) และ [auto demo สำหรับทดสอบซ้ำ](../../../docs/AUTO_DEMO.md) สำหรับสถานะต่อเนื่อง ร่างเก่าถูกปฏิเสธครั้งแรกด้วยข้อความทั่วไป ก่อนเสนอค่าเดิมและผ่านขั้นจำลอง/ตรวจ/อนุมัติ/เปิดใช้ใหม่ ไม่มีคำขอ AI เพิ่มและไม่ Reset ห้อง

**เปิด public alpha บน Cloudflare Free แล้ว การทดสอบ hosted E2E ยังไม่ครบ ไม่ใช่ Production Ready** ใช้สำหรับการทดสอบของเจ้าของและทีมจำนวนน้อย โดยคงรายการที่ยังไม่ยืนยันด้านล่างไว้เป็น release gates

## ระบบที่เปิดจริง

| รายการ | หลักฐาน |
| --- | --- |
| เว็บ | [Tabletop](https://tabletop.ptchrr.workers.dev) |
| Source | [Thanyers/tabletop](https://github.com/Thanyers/tabletop) · branch `feat/tabletop-r1` |
| Runtime commit | `a495cf5617f60af1c51087b54b6c145f0621e938` |
| Active Worker version | `dfdc8c72-2fc2-4344-92c1-44fbc48d80d0` |
| Review | [Draft PR #2](https://github.com/Thanyers/tabletop/pull/2) · ไม่ได้ merge main |
| Hosting | Workers Free + Static Assets + D1 + SQLite Durable Objects `Room` และ `Billing` |
| Database | ฐานใหม่ `tabletop-production` · 7 application tables + migration bookkeeping |
| Login | Google OIDC · scope `openid email profile` · External / Testing |
| AI | DeepSeek `deepseek-flash` ฝั่งเซิร์ฟเวอร์ · ได้เฉพาะ draft |
| ขอบเขต | ไม่เปิด uploads, R2, custom domain, Render หรือ Supabase |

ตัวแอปขึ้นแบบปิด hostname ก่อน ติดตั้งเฉพาะ Google client ID/secret, admin bootstrap email และ DeepSeek key เป็น Worker Secrets แล้วจึงเปิด workers.dev; preview URLs ยังคงปิด ไม่ส่ง GitHub/Cloudflare token เข้า runtime หรือ frontend

## ค่าใช้จ่ายและ configuration

เจ้าของเลือก **Cloudflare Free** หลังอนุมัติวงเงินวางแผน infrastructure 10 USD + AI 10 USD/เดือน ไม่มีการยอมรับ checkout หรือเปิด Paid ฐาน Cloudflare ในรอบนี้จึงเป็น 0 USD และ DeepSeek คิดตามใช้จริง

Deployment configuration ตัด custom `cpu_ms: 50` ออกเพื่อใช้ข้อจำกัด Free ของแพลตฟอร์ม; ค่าที่อ่านกลับไม่มี custom CPU limit เลข 50 ใน source config เดิมไม่ใช่ผลวัด CPU ของแอป ตั้งเพดาน AI ใน runtime ไว้ **1 USD ต่อวัน UTC / 10 USD ต่อเดือน UTC** เพดานนี้ไม่ครอบคลุมการใช้ DeepSeek key เดียวกันจากแอปอื่น

ตรวจแผนและ limits จาก [Workers](https://developers.cloudflare.com/workers/platform/limits/) และ [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) วันที่ 18 ตุลาคม 2026 Free มี CPU/request และโควตารายวัน จึงต้องวัดก่อนเพิ่มผู้ใช้ ไม่ได้มีผล load test หรือค่า p95 CPU ในรายงานนี้

## ผลที่ execute บนลิงก์จริง

| การตรวจ | ผล | ขอบเขตหลักฐาน |
| --- | --- | --- |
| HTTPS, health, readiness | PASS | หน้าหลัก, `/healthz`, `/readyz` ตอบสำเร็จ |
| การป้องกัน API | PASS | ผู้ไม่ล็อกอินเข้า session/admin ไม่ได้; API no-store; internal route 404 |
| หน้าเว็บและ static assets | PASS | CSP / nosniff; hash index ตรง build และ public assets อีก 117 ไฟล์ตรงทั้งหมด |
| Build / secrets | PASS | fresh build จาก runtime commit ที่ CI ผ่าน; ตรวจค่าคีย์จริงกับไฟล์ก่อน upload โดยไม่เปิดเผยค่า |
| Google login เจ้าของ | PASS | ผ่าน Google consent จริง กลับเข้าหน้าเลือกโต๊ะ และแสดงสิทธิ์ Admin |
| สร้างโต๊ะ | PASS | สร้าง Invoice, Physics และ Encounter อย่างละหนึ่งโต๊ะด้วยบัญชีเดียว |
| Reload | PASS | Encounter และร่าง AI ที่อนุมัติแล้วยังอยู่หลังโหลดหน้าใหม่ |
| Logout / login resume | PASS | ออกจาก Tabletop แล้วเข้า Google บัญชีเดิม กลับห้องเดิมและร่างเดิมได้ |
| Admin | PARTIAL | เปิด metadata panel และเห็นห้องที่สร้าง; ยังไม่ทดสอบ role-negative ด้วยบัญชีที่สองบน host |
| AI Encounter | PASS ถึง APPROVED | ได้ร่างป้องกันเพื่อน 1 AP / ครั้งเดียวต่อเทิร์น; simulate และ validate ผ่าน; active ยังคง r0 |
| AI Teaching | PASS หลังส่งใหม่ | ครั้งแรก failed; คำขอเดิมครั้งที่สองได้ draft โดยไม่แก้โค้ด |
| Teaching simulation | PASS | ร่าง F=12 N, m=3 kg, t=2 s ให้ a=4 m/s², v=8 m/s, x=8 m; active เดิมไม่เปลี่ยน |
| AI Invoice | PASS ถึง SIMULATED | เลือก verified sample evidence; ขอคงจำนวนเงิน/วันที่เดิม; before/after ตรงกัน และ unknown 2 rows ยังแยกอยู่ |
| Public upload boundary | PASS | capabilities ระบุปิด และปุ่ม upload ใน Invoice disabled |
| Empty D1 export/restore | PASS แบบจำกัด | export ก่อนมี business data และ restore ลง disposable local DB; ไม่ใช่การพิสูจน์กู้เกมทั้งระบบ |

HTTP checker ผ่าน 14 รายการ ส่วน AI ส่งจาก UI รวม 4 คำขอ ได้ 3 drafts และล้มเหลว 1 ครั้ง ยังไม่ได้ audit ยอดเงินจริงรายคำขอใน hosted ledger หรือใบเรียกเก็บ provider

หลังตรวจมีบัญชีจริง 1 บัญชี, ห้อง 3 ห้อง และ room membership 3 รายการใน D1 รายงานไม่เก็บอีเมล, Google subject, cookie, invitation token หรือ credential values

## สิ่งที่ล้มเหลว หยุด หรือยังไม่ทดสอบ

- **Teaching AI ล้มเหลว 1 ครั้ง:** UI แจ้ง “The proposal could not be completed.” ส่งข้อความเดิมใหม่สำเร็จ จึงยังระบุสาเหตุและทำให้เกิดซ้ำแบบคงที่ไม่ได้ ไม่อ้างว่าแก้สาเหตุแล้ว
- **Encounter Activate หยุด:** automatic approval review ปฏิเสธการเปลี่ยนกติกาถาวรบนระบบจริง จึงคง candidate ไว้ APPROVED และขออนุมัติเฉพาะห้องทดสอบที่สร้าง ไม่มีการอ้อมไปเรียก API เพื่อเปิดใช้
- **สองบัญชี / สองเครื่อง:** ยังไม่ยืนยัน Google login ของบัญชีที่ไม่อยู่ใน Test users, invitation redemption, การซ่อน DM note/คำตอบส่วนตัว, action ของผู้เล่น และ synchronized multiplayer บน host
- **Recovery:** ยังไม่ทดสอบ live hibernation, delayed alarms, revocation กับ WebSocket, redeploy/reconnect, code rollback และการ restore Room/Billing/D1 ให้สอดคล้องกัน
- **งบและโหลด:** ยังไม่ทดสอบชน daily/monthly caps บน host และยังไม่มี concurrency/load benchmark
- **Mobile / console:** ยังไม่ตรวจ hosted narrow viewport แบบเต็ม; Brave ที่ใช้มี extension และพบ message-channel errors ซ้ำ จึงไม่รับรองว่า clean console ผ่าน
- **ข้อความ UI:** manual rate editor ใน Invoice ยังมีป้ายเก่า “live AI not configured” แม้ AI panel ด้านบนเรียกจริงสำเร็จ เป็นข้อผิดพลาดของข้อความที่ยังไม่ได้แก้
- **Invoice ทั้ง workflow:** รอบนี้ใช้ sample data; ไม่รวม private uploads/parser และไม่ได้ตรวจ export, full evidence replacement หรือ activation หลังเปลี่ยนอัตราบน host

Google อธิบายข้อยกเว้นของ External / Testing เมื่อใช้เพียง basic identity scopes ใน [production-readiness overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) แต่เอกสารนี้ไม่แทนการทดสอบบัญชีที่สอง และองค์กรอาจจำกัดแอปผ่าน Workspace policy ได้

## หลักฐาน local / CI ที่แยกจาก host

Runtime commit ผ่าน [PR CI](https://github.com/Thanyers/tabletop/actions/runs/39131194720) และ [push CI](https://github.com/Thanyers/tabletop/actions/runs/39131191452): domain/client/Node 269 tests, Workers/D1/DO/OAuth/ledger 41 tests, Component Lab 7 tests, Node browser 7 scenarios และ Cloudflare browser 8 scenarios พร้อม typechecks, build, audit และ secret checks ผล emulator ใช้ synthetic accounts/provider จึงไม่อ้างเป็น hosted Google/multiplayer acceptance

## Rollback และการกลับมาทดสอบต่อ

นี่เป็นแอปรุ่นแรกบน account นี้ ยังไม่มีรุ่นเก่าที่ผ่าน hosted acceptance ครบ หากพบปัญหาสำคัญ ให้ปิด public workers.dev hostname ของ Worker `tabletop` และรักษา D1/DO ไว้ ห้าม DROP หรือ Reset ห้องเพื่อแทน rollback การปิด hostname อย่างเดียวอาจไม่ตัด WebSocket ที่เชื่อมอยู่ ต้องประเมินการระงับ session/ห้องตามสิทธิ์ที่อนุมัติด้วย

ถ้าจะ rollback code ให้ตรวจความเข้ากันได้กับ schema และ secret bindings ก่อนเลือก Worker version ที่ทราบว่าใช้งานได้ ห้ามเลือก initial version ก่อนติดตั้ง secrets เพียงเพราะสร้างก่อน ขั้นตอนนี้ยังไม่ได้ execute เป็น recovery drill

ลำดับถัดไป: ทดสอบบัญชีเพื่อนและ invite → ตรวจ private projections และ simultaneous actions → ยืนยัน Activate เฉพาะห้องตัวอย่าง → mobile/console → recovery และ budget-negative checks ก่อนยกระดับสถานะ release

**คำแนะนำ: เปิดให้เจ้าของและทีมเล็กทดลองได้ พร้อมเปิดเผยข้อจำกัด; ยังไม่รับรอง Hosted E2E Verified หรือ Production Ready**
