# เอกสาร Tabletop

อ่าน [product.md](../product.md) สำหรับเหตุผล ผู้ใช้ และขอบเขตของ Tabletop; ดู [README](../README.md) สำหรับเรื่องเล่าสาธารณะและภาพประกอบ; เริ่มใช้ที่ [คู่มือผู้ใช้](USER_GUIDE_TH.md) หรือส่งต่องานให้ทีมวิศวกรรมที่ [TEAM_HANDOFF_TH](TEAM_HANDOFF_TH.md) สถานะ URL และรุ่นที่ deploy อ้างอิงจาก [DEPLOYMENTS](DEPLOYMENTS.md)

## เริ่มใช้งานและรับช่วงงาน

| เอกสาร | ใช้เมื่อ |
| --- | --- |
| [README](../README.md) | ต้องการภาพรวมและเรื่องราวผลิตภัณฑ์พร้อมภาพประกอบ |
| [product.md](../product.md) | ต้องการแหล่งอ้างอิงเดียวของ WHY / WHO / WHERE, product intent และขอบเขต beta |
| [USER_GUIDE_TH](USER_GUIDE_TH.md) | ต้องการเปิดเดโม สร้างโต๊ะ เชิญสมาชิก เล่น และกลับมาใช้ห้องเดิม |
| [TEAM_HANDOFF_TH](TEAM_HANDOFF_TH.md) | รับช่วงพัฒนา: สถานะล่าสุด แผนที่โค้ด สถาปัตยกรรม หลักฐาน และขอบเขต deploy |
| [DEPLOYMENTS](DEPLOYMENTS.md) | ตรวจ URL, source/version, resources และผลตรวจ release ล่าสุด |
| [CONTRIBUTING](../CONTRIBUTING.md) | ตั้งเครื่อง พัฒนา ตรวจงาน และส่ง PR |
| [ตัวอย่างสามโจทย์](examples/README.md) | ใช้ไฟล์และ prompt จำลองกับ Shared data table |

## Design, contract และ acceptance

- [GENERATIVE_CANVAS_PLAN_TH](GENERATIVE_CANVAS_PLAN_TH.md): ข้อเสนอจากโจทย์สู่เครื่องมือ/scene ใหม่บน Canvas, algorithm จัดการ์ดตามความสัมพันธ์, multiplayer/memory, แผนทดลองและต้นทุน — ยังไม่ได้ implement
- [GENERATIVE_CANVAS_RESEARCH_2026-10-20](GENERATIVE_CANVAS_RESEARCH_2026-10-20.md): แหล่งต้นทางเรื่อง generative UI, sandbox/QuickJS/Dynamic Workers, sync และ animation พร้อมข้อจำกัดที่ยังไม่พิสูจน์
- [CALM_CANVAS_DESIGN](CALM_CANVAS_DESIGN.md) และ [CALM_CANVAS_ACCEPTANCE](CALM_CANVAS_ACCEPTANCE.md): แนวทาง UI และผลตรวจรุ่นปรับล่าสุด
- [GENERIC_TABLE_DESIGN](GENERIC_TABLE_DESIGN.md): contract, execution, privacy และขอบเขต context/memory
- [GENERIC_TABLE_ACCEPTANCE](GENERIC_TABLE_ACCEPTANCE.md): staging, AI, confirmation, continuity, recovery และ migration
- [R1_ARCHITECTURE](R1_ARCHITECTURE.md): authority/auth/storage ของ runtime เดิมและ Cloudflare ที่ใช้ร่วมกับ generic design
- [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md): Node guest กับ Cloudflare emulator เป็นคนละเส้นทางตรวจ
- [AUTO_DEMO](AUTO_DEMO.md): interactive practice, persona runner และ replay archive
- [DEMO_ART](DEMO_ART.md): ที่มาภาพประกอบที่เตรียมไว้สำหรับ demo

## บันทึกย้อนหลัง

เอกสารเหล่านี้เก็บหลักฐานหรือบริบทตามวันที่ของตัวเอง อย่าใช้ version หรือสถานะ pending ภายในแทน [Deployment ปัจจุบัน](DEPLOYMENTS.md)

- [CLOUDFLARE_RELEASE](CLOUDFLARE_RELEASE.md): provisioning และหลักฐานรุ่นแรก
- [PRODUCTION_SETUP](PRODUCTION_SETUP.md): แนวทางบริการและสมมติฐานราคาเดิม; ทวนก่อนเปลี่ยนแผน
- [R1_DEMO_GUIDE](R1_DEMO_GUIDE.md): ขั้นตอนสาม workflow เดิมใน Node local
- [R1_LOCAL_VERIFICATION](R1_LOCAL_VERIFICATION.md), [AI_PROVIDER_VERIFICATION](AI_PROVIDER_VERIFICATION.md): หลักฐานรอบแรก
- [`handoff/Final/`](../handoff/Final/): แผนและรายงานตามรอบ รวม offline persona replay
