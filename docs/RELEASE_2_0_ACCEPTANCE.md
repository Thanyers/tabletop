# Release 2.0.0 — ผลตรวจและขอบเขต

ตรวจ production ล่าสุด **20 ตุลาคม 2569 เวลา 21:39 (Asia/Bangkok)** จาก annotated tag [v2.0.0](https://github.com/Thanyers/tabletop/tree/v2.0.0), merge commit [d93620d](https://github.com/Thanyers/tabletop/commit/d93620da7cb9a5a97a56d0cfb4275b0fb0fcfda7) ของ [PR #33](https://github.com/Thanyers/tabletop/pull/33) ทั้ง staging และ production ใช้ sealed build เดียวกัน ไม่ได้ build ใหม่ระหว่างส่งสอง environment

## ผลที่ผ่าน

| การตรวจ | หลักฐาน / ผล |
| --- | --- |
| CI ก่อน merge | [5e69816 / 39435691102](https://github.com/Thanyers/tabletop/actions/runs/39435691102) ผ่าน |
| CI บน main merge | [d93620d / 39439056507](https://github.com/Thanyers/tabletop/actions/runs/39439056507) ผ่านก่อนสร้าง annotated tag |
| Unit / local SQL | 376/376 บน Node 22.23.2 |
| Cloudflare / D1 / Room / Billing | 71/71 |
| Browser จำลอง | Node 7, Worker 25, generated 4 เรื่อง/8 checks; generated ใช้ 8 intercepted provider calls, 0 browser errors/external requests |
| คุณภาพ source/build | lint 0 errors, warnings เดิม 101; typecheck/build/Worker dry-run, public/client-secret scans, dependency audit และ auto demo ผ่าน |
| Hosted ก่อน tag | Google สองบัญชีจริงใน Brave และ Codex browser; คาเฟ่และเกมแบ่งน้ำผ่าน AI จริง/เล่นร่วม/สิทธิ์/กลับมาเล่นต่อ |
| Final tagged staging | เปิดสองเรื่องด้วยสองบัญชีเดิมอีกครั้ง: คาเฟ่ 8/0 พร้อมแชทส่วนตัว, น้ำ 65/20/15 รวม 100 และสิทธิ์ตามเทิร์นยังครบ |
| Deployment readback | 4 endpoints × 2 environments ตอบผ่าน, version 2.0.0/d93620d; served assets 135/135 ต่อ environment, Worker modules 2/2 ตรงกันระหว่าง staging/prod |

## สิ่งที่ลงมือเล่นจริง

- **คาเฟ่จากข้อความเปล่า:** ยินยอมส่ง AI → ร่าง scene/chart/form/metric → ทดลองส่วนตัวและ reset → สมาชิกที่เข้าก่อนเปิดใช้ไม่เห็นร่าง → ตรวจและเปิดใช้ → สมาชิกทำ Espresso ได้ 3 นาที เจ้าของทำ Tea รวม 8 → แก้กฎเพิ่ม Remaining Orders ได้ 0 โดยรักษาข้อมูลและชื่อที่ตั้งไว้ → ลากการ์ดด้วย pointer และทั้งสองบัญชีเห็นตำแหน่งเดียวกัน → สมาชิกถาม AI ได้คำตอบส่วนตัวที่เจ้าของไม่เห็น → reload ยังกลับมาได้
- **เกมแบ่งน้ำจากไฟล์ใหม่ที่เขียนเอง:** แนบ Markdown สมมติผ่านหน้าเว็บ → AI ร่างกฎ/ฉาก/ตัวควบคุม → ตรวจและเปิดใช้ → เจ้าของส่งน้ำ Red20 แล้วสมาชิก Blue15 ผลทั้งสองหน้าคือน้ำกลาง65, Red20, Blue15, รวม100 → เทิร์น/สิทธิ์ควบคุมสลับถูกต้อง → ปิดแท็บทั้งสองและเปิดกลับยังได้ค่าเดิม การเลือกทีมคนอื่นถูกปฏิเสธใน private preview; ไม่อ้างว่าเป็นหลักฐาน server rejection ของกรณีนั้น
- **ขอบเขตข้อมูล:** URL ห้องที่ยังไม่ได้รับเชิญเปิดไม่ได้; สมาชิกไม่เห็นปุ่มแก้ชื่อ/กฎ/แนบไฟล์หรือ raw source; แชทแยกผู้ถาม พฤติกรรมไฟล์นี้เป็นของ2.0.0 ส่วน F008/PR34 ที่จะเปิดไฟล์ให้สมาชิกยังเป็น draft แยก
- **พักแล้วเปิดคืน:** staging ใช้ TABLE_READ_ONLY ชั่วคราวโดยคง config อื่น; คำสั่งเล่นและคำขอ AI จากหน้าที่ค้างอยู่ได้รับข้อความปฏิเสธจริงจาก server ก่อนเขียน/dispatch จากนั้นคืน config ปกติและตรวจค่าทั้งสองห้อง/แชท/ปุ่มตามเทิร์นอีกครั้ง production ไม่ได้รับ toggle นี้

รอบนี้ใช้สองห้องสมมติเพิ่มจากสี่ห้องเดิม รวม staging หกห้อง คงเพดาน AI USD0.20/วันและเดือน ไม่มี SQL migration, secret, binding, credential หรือ quota ใหม่ มีงานร่าง AI สำเร็จ3งานและแชทจริง1งาน; อาจมี repair ภายใน จึงไม่แปลงจำนวนงานเป็นจำนวน provider attempts หรือค่าใช้จ่ายที่ยืนยันแล้ว

## บั๊กที่พบและแก้ก่อนปล่อย

ฟอร์มที่ advanceTurn ใช้ผล preview ไปตัดสินสิทธิ์ ทำให้เปลี่ยนค่าแล้วปุ่ม submit ปิดก่อนส่งคำสั่งจริง แก้ใน1c66f91 ให้ visuals preview ได้ แต่ controls, input bindings, role/turn และ submission อิง committed state เพิ่ม guard36fd5fa ให้หยุดเมื่อประเมิน committed projection ไม่ได้ ไม่มี speculative fallback ส่วน5e69816 แยก fixture สามที่นั่งของ browser ออกจาก fixture สองที่นั่งของ unit เดิม เพื่อไม่เปลี่ยน oracle ของเทสต์อื่น

Regression เกิด FAIL ก่อนแก้และผ่านหลังแก้; reviewer ปิด finding เรื่อง fallback แล้ว ชุด CI ครอบคลุม form/slider/scene และการป้องกันส่งซ้ำ แต่ไม่ได้ fault-inject ทุกกรณี projection failure ผ่าน UI

## ที่มาของหลักฐานและสิ่งที่ยังไม่ได้ตรวจ

คาเฟ่สร้างและเล่นเต็มบน21ac03d, น้ำเล่นจริงบน36fd5fa, ทั้งสองห้อง resume/recovery บน5e69816; 135ไฟล์ที่ไม่ใช่ version.json ตรงกันระหว่าง36fd5fa→5e69816 Final tag มี tree ตรงกับ5e69816 และ non-version output ตรงกัน จึงไม่อ้างว่าทุกขั้นของคาเฟ่ถูกเล่นซ้ำบน SHA สุดท้าย

ใช้ Google sessions จริงที่ล็อกอินอยู่แล้ว ไม่ได้ทำ password/consent flow ใหม่ ไม่ได้ทดสอบโทรศัพท์จริง, load/soak, accessibility ทั้งชุด หรือกู้ D1+Room+Billing ทั้งระบบ Production ตรวจ endpoints/assets/Worker bytes และเปิด UI โดยไม่สร้างห้องหรือใช้ AI เพิ่ม

หลักฐาน operator และ browser ที่มี room/account context เก็บใน ignored local test-results/release-2.0.0/ ไม่เผยแพร่ค่าเฉพาะบัญชี/ห้องหรือ invite ใน public repo ดู [Deployment](DEPLOYMENTS.md) และ [Handoff](TEAM_HANDOFF_TH.md) สำหรับวิธีเล่นและงานต่อ
