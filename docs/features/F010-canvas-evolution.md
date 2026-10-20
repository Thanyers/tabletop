# F010 — ต่อเติมโต๊ะผ่านแชทและการ์ดที่ใช้งานได้

| | |
| --- | --- |
| สถานะ | `review` · PR #42 · ยังไม่ deploy |
| เจ้าของ | Codex ตามคำขอผู้ใช้ 20 ตุลาคม 2026 |
| งาน | F010-T1 ใน PLAN.md |
| Release | ประเมินความเข้ากันได้ของ writer หลังทำเสร็จ; รอบนี้ไม่เปลี่ยนฐานหรือ deploy |

## ปัญหา

โต๊ะ invoice ว่างมีแต่ปุ่มแก้สถานะ ผู้ใช้ขอเพิ่มข้อมูลหรือ UI ผ่านแชทกลับถูกบอกให้ไปแก้โปรแกรมเอง การตรวจและเปิดใช้กฎมีศัพท์และขั้นตอนมาก การ์ดคำตอบไม่มี padding และ controls ถูกตัดในพื้นที่เล็ก

## ขอบเขต

- ศึกษา POC ที่ผู้ใช้ส่ง แล้วนำ workflow/composition ที่เหมาะกับ runtime จริงมาใช้
- เจ้าของต่อเติมตาราง ฟอร์ม ปุ่ม และเพิ่มข้อมูลผ่านการกระทำที่ตรวจบน server; คงการยินยอมและยืนยันก่อนแก้สถานะร่วม
- เพิ่มความสามารถสร้าง record ที่ runtime ยังขาด โดยไม่เขียนทับข้อมูลเดิมเมื่อแก้กฎ
- ลดการเปิดเผยรายละเอียดกฎบนเส้นทางปกติ และแก้ padding/overflow/ขนาดการ์ด
- ไม่คัดลอก sandbox Node VM มาเป็นขอบเขตความปลอดภัยของ production และไม่เปลี่ยน hosting/credentials/SQL schema

## เกณฑ์ตรวจ

โต๊ะ invoice เริ่มไม่มีข้อมูล → ขอเพิ่มฟอร์มและปุ่ม → ตรวจ/เปิดใช้ → กรอกและกดเพิ่ม record จริง → แก้สถานะด้วยปุ่ม → เพิ่มการ์ดใหม่โดยคงข้อมูลเดิม → reload แล้วข้อมูลอยู่ครบ ตรวจสิทธิ์สมาชิก/ความขัดแย้งที่จุดเปลี่ยน และวัดขอบเขตการ์ด/ฟอร์มที่แก้ ไม่รันทุกเดโมซ้ำโดยไม่มีเหตุ

## การตัดสินใจ

| วันที่ | เรื่อง |
| --- | --- |
| 2026-10-20 | ใช้ POC เป็น reference ของประสบการณ์ แต่ยึด server authority, CAS, idempotency และ safe interpreter ของแอปจริง |
| 2026-10-20 | เพิ่ม typed `creates` และ field default ใน JSON program เดิม; ร่างแก้ไขเพิ่ม collection/field ได้แต่ห้ามลบหรือเปลี่ยนของเดิมและห้ามใช้ initialRecords ทับข้อมูล |
| 2026-10-20 | แชทเลือก builder สำหรับคำขอ UI ที่ชัดเจน และมี owner-only build-request fallback; ส่งต่อคำขอเดิมโดยตรวจ consent ของผู้ใช้/โต๊ะ/epoch ตาม F013 ไม่ส่งคำสั่งจากข้อความโมเดลไปทำงานอัตโนมัติ |
| 2026-10-20 | ปุ่ม Apply to table ใช้คำสั่งตรวจเดิมตามลำดับและตรึง candidate/revision; รายละเอียดและ private trial ยังเปิดได้ ไม่ใช้ autoactivation ตาม POC |
| 2026-10-20 | สัญญา JSON ใหม่มี creates/default/build-request; writer รุ่นเก่าที่ไม่รู้จักสัญญานี้ใช้ rollback ไม่ได้หลังบันทึก ต้องเลือกเวอร์ชัน release และ compatible recovery แยกก่อน deploy ไม่มี SQL migration |
| 2026-10-20 | รวม `origin/dev` ที่ `bac174b` ระหว่างส่ง PR: คง F013 ของทีมที่ให้ consent ครั้งเดียวต่อคน/โต๊ะ/epoch ครอบคลุมทั้งสองโหมดและไฟล์ภายหลังตามที่ผู้ใช้เลือก และคง pipeline CD001; แก้เฉพาะบรรทัด Changelog ที่ชนแล้วปรับ focused test ให้ตรวจ consent ครั้งแรก/ไม่ถามซ้ำ |
| 2026-10-21 | CI พบขนาดการ์ดใหม่ไปกระทบ geometry ของเดโมเก่า จึงจำกัด CSS การ์ดใหม่ด้วย `data-workspace-kind="table"` และคืนขนาดเดิมให้ legacy workspaces; ตรวจซ้ำเฉพาะ browser suites ที่ล้มและ Invoice workflow |

## ผลตรวจ

Node `22.23.2`; ใช้ฐาน D1/SQLite Durable Objects local ที่ทิ้งได้ ไม่เขียนห้องผู้ใช้หรือฐาน hosted

| การตรวจ | ผล |
| --- | --- |
| Focused Vitest: table, record creation, generative validation, provider, intent, chat state, pinned apply | **PASS 67/67** ใน 8 files (รวม consent F013 หลัง merge) |
| Cloudflare assistant รวม owner build handoff / participant negative | **PASS 10/10** |
| `npm run build` / `npm run build:cloudflare` | **PASS**; Cloudflare เป็น dry-run เท่านั้น |
| `node scripts/canvas-evolution-local.mjs --auto` | **PASS 10 checks**: โต๊ะว่าง → ขอ UI → Apply → กรอกเพิ่มแถว → sample → paid → เพิ่ม summary/collection/default field → reload → member ไม่ได้เปิด builder |
| วัด UI ที่เปลี่ยน | **PASS** เปิดฟอร์มจาก Canvas ที่ 320/414/1440 px; กรอบอยู่ในจอและไม่มี horizontal overflow; padding ฟอร์มและคำตอบ 16px; ตาราง invoice สาม field ไม่ถูกบังคับขั้นต่ำ 720px ให้เกิดแถบเลื่อนโดยไม่จำเป็น ภาพและค่าจริงเก็บใน ignored test-results |
| Regression หลังจำกัด CSS | **PASS** `npm run test:r1:browser` 7 checks และ `npm run test:cloudflare:browser` 25 checks; เดโมเดิมไม่เกิด card overlap และ generic Invoice fixture ยังผ่าน 10 checks หลังแก้ |
| AI จริงผ่าน browser UI | **PASS หลังลองคำขอแรกใหม่หนึ่งครั้ง**: สร้างฟอร์ม/ปุ่ม, เพิ่ม 1,250.50 และ sample 250, paid รายการแรก, ขอการ์ดสรุปค้าง 250, Apply และ reload แล้วสองแถว/สถานะอยู่ครบ รอบสำเร็จใช้ 3 provider calls สำหรับ 2 คำขอ มีการซ่อม initialRecords หนึ่งครั้ง |
| รอบ AI แรก | **FAIL validation** ทั้ง 3 attempts; ไม่มีการเปิดใช้ร่างนั้น รวมรอบแรกและรอบสำเร็จ 6 provider calls ไม่ใช่หลักฐานว่าทุกคำขอจะผ่านเสมอ |
| ตรวจแยกโดย reviewer | **PASS** ไม่พบ material blocker หลังแก้ routing ที่จับ data action ไป builder ผิด; ไม่แก้ไฟล์ระหว่างตรวจ |
| Lint / public-file scan | **PASS** lint ไฟล์ที่เปลี่ยน 0 errors (6 existing warnings), ไม่พบข้อมูลลับจาก scanner |
| Hosted / Google สองบัญชี / full accessibility gate | **SKIPPED** รอบนี้ตรวจเฉพาะ local และส่วนที่แก้ ไม่ใช่ release acceptance |

คำสั่งทดสอบซ้ำ: build ทั้งสองฝั่ง แล้ว `node scripts/canvas-evolution-local.mjs --auto` ใช้โมเดลและบัญชีจำลอง; AI จริงเป็น opt-in ด้วย `--serve --real-ai` และ `TABLETOP_CREDENTIAL_FILE` ชี้ไฟล์ ignored เดิม ไม่ใส่ค่าคีย์ในคำสั่งหรือ Git เก็บคำตอบ/repair issues เฉพาะข้อมูล fixture สังเคราะห์ใน ignored outputs

ข้อแก้จากการกดจริง: numeric input ของ generated form ต้องมี `step="any"` เช่นเดียวกับฟอร์ม action ปกติ มิฉะนั้น minimum 0.01 กับจำนวนเงิน 651 ทำให้ browser ปฏิเสธ submit แม้อยู่ใน bounds แล้ว
