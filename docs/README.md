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
| [AGENT_WORKFLOW](AGENT_WORKFLOW.md) | ใช้ Codex / Claude Code / OpenCode / DeepSeek Harness ร่วมกัน ตรวจ dev ล่าสุด และรับกติกาใหม่ |
| [AGENT_OPERATIONS](AGENT_OPERATIONS.md) | รายละเอียด CI, release, deploy และ ruleset ที่ agent ต้องอ่านก่อนทำงานส่วนนั้น |
| [ตัวอย่างสามโจทย์](examples/README.md) | ใช้ไฟล์และ prompt จำลองกับ Shared data table |

## Design, contract และ acceptance

รายละเอียดสถานะรุ่นอยู่ใน [Deployments](DEPLOYMENTS.md) ส่วนผลตรวจร้านกาแฟ แสงและเงา เกมแบ่งน้ำ และลิงก์ CI ที่เคยสรุปบน README ตามได้จาก [Generative Canvas acceptance](GENERATIVE_CANVAS_ACCEPTANCE.md) และ [Release 2.0 acceptance](RELEASE_2_0_ACCEPTANCE.md) ทั้งสองเป็นบันทึกตามรอบตรวจของตัวเอง ไม่ใช่การยืนยันรุ่นปัจจุบัน

- [GENERATIVE_CANVAS_RUNTIME](GENERATIVE_CANVAS_RUNTIME.md): candidate ที่กำลังทดสอบสำหรับภาพ/สูตร/เครื่องมือใหม่บน Canvas, ทดลองร่าง, layout ร่วมกัน และการค้นบทสนทนาเดิม
- [REUSABLE_COMPUTE](REUSABLE_COMPUTE.md): โปรแกรม JavaScript/Python ที่เก็บไว้คำนวณซ้ำ, typed input/output, run lineage, Rules และการเตรียม runtime ก่อน release
- [F066 post-deploy test pack](testing/f066-post-deploy/README_TH.md): 48 เคส พร้อมข้อมูลสมมติ ผลอ้างอิง และแบบบันทึกผล; acceptance ทุกเคสยัง NOT_RUN รอรอบหลัง deploy
- [GENERATIVE_CANVAS_ACCEPTANCE](GENERATIVE_CANVAS_ACCEPTANCE.md): หลักฐานและขอบเขตของ candidate แยกโมเดลจำลอง, AI จริง และ hosted release
- [GENERATIVE_CANVAS_PLAN_TH](GENERATIVE_CANVAS_PLAN_TH.md): แผนจากโจทย์สู่เครื่องมือ/scene ใหม่บน Canvas, algorithm จัดการ์ดตามความสัมพันธ์, multiplayer/memory และต้นทุน — ดู runtime/acceptance สำหรับส่วนที่ทำแล้ว
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
