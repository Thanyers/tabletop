# Generative Canvas acceptance

Candidate: `feat/F005-generative-canvas` · Node `22.23.2` · 2026-10-20

สถานะ: กำลังทดสอบ ยังไม่อนุมัติ release และไม่ได้ deploy candidate นี้ไป staging หรือ production

## ขอบเขต

ทดสอบ local Worker/D1/Room/Billing กับข้อมูลสมมติ บัญชีและ session จำลองทั้งหมด; แยก provider จำลองที่ทำซ้ำได้ใน CI ออกจากการเรียก AI จริงแบบ opt-in

โจทย์หลักคือคิวร้านกาแฟ, แสงและเงา, และการแบ่งน้ำแบบผลัดกันเล่น พร้อมโจทย์คำนวณเงินกู้ที่ใช้สูตรใหม่เพื่อทดสอบนอก catalog เดิม ตรวจการสร้างจากไฟล์และ prompt, ทดลองร่างส่วนตัว, เปิดใช้, กด/ลาก/ปรับค่า, แก้เครื่องมือโดยเก็บข้อมูลเดิม, สอง actor, shared layout และกลับเข้าห้อง

## หลักฐานที่ต้องเก็บก่อนปิดงาน

| ชุดตรวจ | ที่เก็บผล local | สถานะ |
| --- | --- | --- |
| Unit/SQL และขอบเขต interpreter | `test-results/unit-report.json` | กำลังรวมผลรอบสุดท้าย |
| Worker/D1/Room/Billing | `test-results/cloudflare-report.json` | กำลังรวมผลรอบสุดท้าย |
| Browser regression เดิม | `test-results/cloudflare-browser/report.json` | กำลังทดสอบ |
| Generative browser, provider จำลอง | `test-results/generative-canvas/report.json` | กำลังทดสอบ |
| Generative browser, provider จริง | `test-results/generative-live/report.json` | รอบแรกพบปัญหา schema/สูตรและกำลังซ่อม |
| Independent review | ตรวจ source candidate และ regression | กำลังปิดสองข้อค้นพบ |

ผลและภาพใน `test-results/` เป็นหลักฐานในเครื่องที่ไม่ commit; CI เก็บเฉพาะผล fixture จำลองเป็น artifacts ไม่มี credential หรือประวัติผู้ใช้จริงใน repo

## สิ่งที่ยังไม่ยืนยัน

Google สองบัญชีจริงของ candidate นี้, สองอุปกรณ์/นิ้วบนโทรศัพท์จริง, hosted Workers Free CPU/latency, load/soak, full accessibility audit และการกู้ D1 + Room + Billing ทั้งระบบ

การค้นบทสนทนาจำกัด 100 รายการล่าสุดในห้อง/epoch/ผู้ถามเดียวกัน และส่งไม่เกิน 6 คู่/16 KiB; ไม่ใช่ความจำไม่จำกัด ไม่มี schema migration, shared simulation clock, arbitrary JavaScript sandbox หรือ image generation ในรอบนี้

ดู [runtime](GENERATIVE_CANVAS_RUNTIME.md) สำหรับวิธีใช้ contract และขอบเขต recovery; ใช้ [DEPLOYMENTS](DEPLOYMENTS.md) ตรวจรุ่นที่ขึ้นจริง
