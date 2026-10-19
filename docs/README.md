# ดัชนีเอกสาร Tabletop

## อ่านตามงาน

| เอกสาร | หน้าที่ |
| --- | --- |
| [README](../README.md) | ภาพรวมผลิตภัณฑ์และลิงก์เริ่มต้น |
| [USER_GUIDE_TH](USER_GUIDE_TH.md) | วิธีใช้เดโม ห้องจริง นำเข้า เชิญคน เล่น แชท และ resume |
| [TEAM_HANDOFF_TH](TEAM_HANDOFF_TH.md) | สถาปัตยกรรม จุดเริ่มโค้ด ผลทดสอบ งานต่อ และวิธีรับหน้าที่ operator |
| [DEPLOYMENTS](DEPLOYMENTS.md) | แหล่งอ้างอิงปัจจุบันของ URL, source/version, resources และงบที่ตั้งไว้ |
| [CONTRIBUTING](../CONTRIBUTING.md) | ตั้งเครื่อง ทดสอบ และส่ง PR |
| [ตัวอย่างสามโจทย์](examples/README.md) | ไฟล์จำลองและ prompt สำหรับ Shared data table |

## รายละเอียดเฉพาะเรื่อง

- [GENERIC_TABLE_DESIGN](GENERIC_TABLE_DESIGN.md): contract, execution, privacy และขอบเขต context/memory
- [GENERIC_TABLE_ACCEPTANCE](GENERIC_TABLE_ACCEPTANCE.md): staging สองบัญชีจริง, AI, confirmation, continuity, recovery และ migration production ที่อนุมัติ
- [R1_ARCHITECTURE](R1_ARCHITECTURE.md): authority/auth/storage ของ runtime เดิมและ Cloudflare ใช้ร่วมกับ generic design
- [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md): Node guest และ Cloudflare emulator เป็นคนละ test path
- [AUTO_DEMO](AUTO_DEMO.md): interactive practice, persona runner และ replay archive
- [DEMO_ART](DEMO_ART.md): prompt และที่มาภาพที่เตรียมไว้สำหรับ demo

## เอกสารย้อนหลัง / ขอบเขตเฉพาะ

เอกสารต่อไปนี้เก็บบริบทเดิมไว้ ไม่ใช้ค่า version หรือสถานะ pending ในนั้นแทน [Deployment ปัจจุบัน](DEPLOYMENTS.md)

- [CLOUDFLARE_RELEASE](CLOUDFLARE_RELEASE.md): การ provision รุ่นแรกและหลักฐาน ณ 18–19 ต.ค.
- [PRODUCTION_SETUP](PRODUCTION_SETUP.md): แนวทางบริการ/credential และราคาอ้างอิงตามวันที่ในเอกสาร; ต้องทวนก่อนเปลี่ยนแผน
- [R1_DEMO_GUIDE](R1_DEMO_GUIDE.md): ขั้นตอนของสาม workflow เดิมใน Node local
- [R1_LOCAL_VERIFICATION](R1_LOCAL_VERIFICATION.md), [AI_PROVIDER_VERIFICATION](AI_PROVIDER_VERIFICATION.md): หลักฐานรอบแรก มี source/date ของตัวเอง
- [`handoff/Final/`](../handoff/Final/): แผนและรายงานตามรอบ รวมถึง offline persona replay

โครงสร้างชุดนี้ใช้ architecture/design/acceptance ที่มีอยู่ต่อ จึงไม่สร้าง product/context/design หรือ ADR ซ้ำเนื้อหาเดิม ไม่พบ skill เฉพาะ Tabletop ใน project/global catalog ที่ต้องย้าย และไม่มีการคัดลอก global skills หรือ credential มาใน repo
